import { BinanceTrader } from './bot.js';

const configEUR = {
    asset: 'EUR',
    base: 'USDT',
    clearanceSell: 0.015,
    clearanceBuy: 0.007,
    tickInterval: 10000,
    buyStepInEuro: 20,
    limitBase: 500,
};

const uahTrade = new BinanceTrader(configEUR);
uahTrade.tick();
