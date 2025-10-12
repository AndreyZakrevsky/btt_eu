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
        if (!this.db?.data?.operationData) this._initDefault();
    }

    async _initDefault() {
        this.db.data = {
            operationData: {
                averageBuyPrice: 0,
                buy: 0,
                amount: 0,
                fee: 0,
            },
            successfullyClosed: 0,
        };
        await this.db.write();
    }

    async setData(quantity, price, fee = 0) {
        if (!quantity || !price || quantity <= 0 || price <= 0) return null;

        const { buy = 0, amount = 0, fee: currentFee = 0 } = this.db.data.operationData;

        const buyBig = new Big(buy);
        const amountBig = new Big(amount);
        const feeBig = new Big(currentFee);

        const newbuy = buyBig.plus(new Big(quantity).times(new Big(price)));
        const newAmount = amountBig.plus(new Big(quantity));
        const newFee = feeBig.plus(new Big(fee));

        this.db.data.operationData.buy = newbuy.toNumber();
        this.db.data.operationData.amount = newAmount.toNumber();
        this.db.data.operationData.fee = newFee.toNumber();
        this.db.data.operationData.averageBuyPrice = newAmount.gt(0) ? newbuy.div(newAmount).toNumber() : 0;

        await this.db.write();
    }

    async updateData(profit) {
        this.db.data.operationData = {
            averageBuyPrice: 0,
            buy: 0,
            amount: 0,
            fee: 0,
        };

        this.db.data.successfullyClosed += profit;
        await this.db.write();
    }

    async cleanUp() {
        await this._initDefault();
    }

    async getData() {
        await this.db.read();
        return this.db?.data?.operationData;
    }
}
