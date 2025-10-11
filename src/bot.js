import ccxt from 'ccxt';
import Big from 'big.js';
import 'dotenv/config';
import { DatabaseLocal } from './services/localDb.service.js';
import { Telegraf, Markup } from 'telegraf';

const EXCHANGE_FEE_PERCENT = 0.002;

export class BinanceTrader {
    constructor(tradeConfig) {
        this.binanceClient = new ccxt.binance({
            apiKey: process.env.API_KEY,
            secret: process.env.API_SECRET,
            options: { adjustForTimeDifference: true },
        });

        this.step = Number(tradeConfig.buyStepInEuro);
        this.maxVolume = Number(tradeConfig.limitBase);
        this.sellClearance = Number(tradeConfig.clearanceSell);
        this.buyClearance = Number(tradeConfig.clearanceBuy);
        this.configTrade = tradeConfig;

        this.tg_bot = new Telegraf(process.env.TG_TOKEN);
        this.dbService = new DatabaseLocal();
        this.sellBuffer = 0.0005;

        this.market = `${tradeConfig.asset}/${tradeConfig.base}`;
        this.averageBuyPrice = 0;
        this.buyAmount = 0;
        this.tickCount = 0;
        this.isTrading = false;
        this.currentPrice = null;
        this.fee = 0;
        this.interval = this.configTrade.tickInterval;

        this._setupBotInterface();

        this.tg_bot.launch();
        process.once('SIGINT', () => this.tg_bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.tg_bot.stop('SIGTERM'));
    }

    async tick() {
        while (this.isTrading) {
            await this._sleep(this.interval);
            await this._trade();
            this.tickCount += 1;
        }
    }

    async _trade() {
        const { averageBuyPrice = 0, amount = 0, fee = 0 } = await this.dbService.getData();
        this.averageBuyPrice = averageBuyPrice;
        this.buyAmount = amount;
        this.fee = fee;
        this.currentPrice = await this._getLastMarketPrice();

        if (!this.currentPrice || !this.isTrading) return;
        if (averageBuyPrice === 0) return await this._buy(this.step);

        const priceDifference = new Big(this.currentPrice).minus(new Big(this.averageBuyPrice)).toNumber();

        if (priceDifference > 0 && this.buyAmount < this.maxVolume) {
            const canSell = await this._canSellWithFlexibility();
            if (this.averageBuyPrice + this.sellClearance < this.currentPrice && canSell) {
                return await this._sell(this.buyAmount);
            }
        }

        if (priceDifference < 0) {
            if (this.averageBuyPrice - this.buyClearance >= this.currentPrice) {
                return await this._buy(this.step);
            }
        }
    }

    async _canSellWithFlexibility() {
        try {
            const orderBook = await this.binanceClient.fetchOrderBook(this.market);
            const bids = orderBook.bids.slice(0, 20);

            const filteredBids = bids.filter(([orderPrice]) => orderPrice >= this.averageBuyPrice - this.sellBuffer);

            const totalVolume = filteredBids.reduce((acc, [, orderAmount]) => acc + orderAmount, 0);

            return totalVolume >= this.buyAmount;
        } catch (error) {
            console.error('Error in canSellWithFlexibility:', error);
            return false;
        }
    }

    async finishSelling() {
        const profit = await this.getCurrentProfit();

        await this.dbService.updateData(profit);
    }

    async getCurrentProfit() {
        if (!this.currentPrice) return 0;

        const { fee = 0 } = await this.dbService.getData();
        const buyAmount = new Big(this.buyAmount);
        const currentPrice = new Big(this.currentPrice);
        const averageBuyPrice = new Big(this.averageBuyPrice);

        return currentPrice.minus(averageBuyPrice).times(buyAmount).minus(fee).toFixed(5);
    }

    async _sell(amount) {
        try {
            const { status } = await this.binanceClient.createMarketSellOrder(this.market, amount);

            if (status === 'closed') await this.finishSelling();
        } catch (e) {
            console.log(`❌ SELL ERROR: ${e.message}`);
        }
    }

    async _buy(amount) {
        try {
            const baseBalance = await this._getBaseBalance();
            if (baseBalance < this.step * 1.5) return;

            const { status, price } = await this.binanceClient.createMarketBuyOrder(this.market, amount);

            if (status === 'closed') await this.dbService.setData(amount, price, amount * EXCHANGE_FEE_PERCENT);
        } catch (e) {
            console.log(`❌ BUY ERROR: ${e.message}`);
        }
    }

    async _getBaseBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' });
            const { free } = info?.balances.find((item) => item.asset === this.configTrade.base);
            return free ? Number(free) : null;
        } catch (e) {
            console.log('BASE BALANCE || ', e.message);
            return null;
        }
    }

    async _getAssetBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' });
            const { free } = info.balances.find((item) => item.asset === this.configTrade.asset);
            return free ? Number(free) : null;
        } catch (e) {
            console.log('ASSET BALANCE || ', e.message);
            return null;
        }
    }

    async _getLastMarketPrice() {
        try {
            const {
                info: { lastPrice = null },
            } = await this.binanceClient.fetchTicker(this.market);
            return Number(lastPrice);
        } catch (e) {
            return null;
        }
    }

    _sleep(time) {
        return new Promise((resolve) => setTimeout(resolve, time));
    }

    _setupBotInterface() {
        this.tg_bot.start(async (ctx) => {
            await ctx.reply(
                'Welcome to Binance Trader Bot! Use the buttons below to control the bot.',
                Markup.keyboard([
                    ['Start Trading', 'Stop Trading'],
                    ['Status', 'Clean'],
                ])
                    .resize()
                    .persistent()
            );
        });

        this.tg_bot.hears('Start Trading', async (ctx) => {
            if (this.isTrading) {
                return ctx.reply('❗ Trading is already running.');
            }

            this.isTrading = true;
            ctx.reply('✅ Trading has started!');
            this.tick();
        });

        this.tg_bot.hears('Stop Trading', async (ctx) => {
            if (!this.isTrading) {
                return ctx.reply('❗ Trading is already stopped.');
            }

            this.isTrading = false;
            ctx.reply('🛑 Trading has stopped!');
        });

        this.tg_bot.hears('Status', async (ctx) => {
            const operationData = await this.dbService.getData();
            const { buy = 0, amount = 0, fee = 0, averageBuyPrice = 0 } = operationData || {};
            const profit = await this.getCurrentProfit();
            const awaitingSell = this.averageBuyPrice + this.sellClearance;
            const awaitingBuy = this.averageBuyPrice - this.buyClearance;

            const extendedInfo = `
Status ${this.market}: ${this.isTrading ? '✅ Running' : '🛑 Stopped'}
Current price (USDT): ${this.currentPrice || 0}

Average price (USDT): ${averageBuyPrice}
Total spent (USDT): ${buy}
Total (EUR): ${amount}
Fee: ${fee}
Profit (USDT): ${profit}

Step: ${this.step}
Limit: ${this.maxVolume}
Sell buffer: ${this.sellBuffer}
Interval (sec): ${this.interval / 1000}

AWAITING TO SELL:  [${this.sellClearance}]  ${awaitingSell?.toFixed(4)}
AWAITING TO BUY:   [${this.buyClearance}]  ${awaitingBuy?.toFixed(4)} `;

            ctx.reply(extendedInfo);
        });

        this.tg_bot.hears('Clean', async (ctx) => {
            await ctx.reply(
                '⚠️ Are you sure you want to clean the database?',
                Markup.inlineKeyboard([Markup.button.callback('Yes', 'clean_confirm'), Markup.button.callback('No', 'clean_cancel')])
            );
        });

        this.tg_bot.action('clean_confirm', async (ctx) => {
            await this.dbService.cleanUp();
            ctx.reply('✅ Database cleaned successfully.');
        });

        this.tg_bot.action('clean_cancel', async (ctx) => {
            ctx.reply('❌ Clean operation canceled.');
        });

        this.tg_bot.command('set', async (ctx) => {
            try {
                const text = ctx.message.text;
                const params = text
                    .split(' ')
                    .slice(1)
                    .reduce((acc, param) => {
                        const [key, value] = param.split('=');
                        acc[key] = parseFloat(value);
                        return acc;
                    }, {});

                let shouldRestart = false;

                if (!isNaN(params.sell)) {
                    this.sellClearance = params.sell;
                    shouldRestart = true;
                }

                if (!isNaN(params.interval)) {
                    this.interval = params.interval * 1000;
                    shouldRestart = true;
                }

                if (!isNaN(params.buy)) {
                    this.buyClearance = params.buy;
                    shouldRestart = true;
                }

                if (!isNaN(params.limit)) {
                    this.maxVolume = params.limit;
                    shouldRestart = true;
                }

                if (!isNaN(params.step)) {
                    this.step = params.step;
                    shouldRestart = true;
                }

                if (!isNaN(params.buffer)) {
                    this.bufferAsk = params.buffer;
                    shouldRestart = true;
                }

                if (!shouldRestart) {
                    return ctx.reply('❗ No valid parameters provided. Valid parameters: sell, buy, limit, step, buffer. All values ​​must be numeric');
                }

                this.isTrading = false;
                ctx.reply(`✅ Configuration updated. The bot is stopped. Restart it to apply changes.`);
            } catch (error) {
                console.error('Error in set command:', error);
                ctx.reply('❌ An error occurred while processing your command. Please try again.');
            }
        });
    }
}
