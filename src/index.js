import { BinanceTrader } from './bot.js';

const configEUR = {
    asset: 'EUR',
    base: 'USDT',
    clearanceSell: 0.02,
    clearanceBuy: 0.01,
    tickInterval: 10000,
    buyStepInEuro: 15,
    limitBase: 500,
};

const uahTrade = new BinanceTrader(configEUR);
uahTrade.tick();
