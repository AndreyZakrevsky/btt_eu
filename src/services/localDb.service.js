import fs from 'fs';
import path from 'path';
import { Low, JSONFile } from 'lowdb';
import Big from 'big.js';

export class DatabaseLocal {
    constructor(uniqueName = 'default') {
        const dbFolder = path.resolve(process.cwd(), 'db');
        if (!fs.existsSync(dbFolder)) {
            fs.mkdirSync(dbFolder);
        }

        const fileName = `${uniqueName}-localDB.json`;
        const filePath = path.join(dbFolder, fileName);

        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
        }

        const adapter = new JSONFile(filePath);
        this.db = new Low(adapter);

        this._initialize();
    }

    async _initialize() {
        await this.db.read();
        if (typeof this.db?.data?.averageBuyPrice !== 'number' || typeof this.db?.data?.buy !== 'number' || typeof this.db?.data?.amount !== 'number') {
            await this._initDefault();
        }
    }

    async _initDefault() {
        this.db.data = {
            averageBuyPrice: 0,
            buy: 0,
            amount: 0,
        };
        await this.db.write();
    }

    async setData(quantity, price) {
        if (!quantity || !price || quantity <= 0 || price <= 0) return null;

        const buy = this.db.data.buy ?? 0;
        const amount = this.db.data.amount ?? 0;

        const buyBig = new Big(buy);
        const amountBig = new Big(amount);

        const newBuy = buyBig.plus(new Big(quantity).times(new Big(price)));
        const newAmount = amountBig.plus(new Big(quantity));

        this.db.data.buy = newBuy.toNumber();
        this.db.data.amount = newAmount.toNumber();
        this.db.data.averageBuyPrice = newAmount.gt(0) ? newBuy.div(newAmount).toNumber() : 0;

        await this.db.write();
    }

    async cleanUp() {
        await this._initDefault();
    }

    async getData() {
        await this.db.read();
        const { averageBuyPrice = 0, buy = 0, amount = 0 } = this.db.data ?? {};
        return { averageBuyPrice, buy, amount };
    }
}
