import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import RecordedHistory from '../../db/entities/RecordedHistory';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IRecordedHistoryDB from './IRecordedHistoryDB';

@injectable()
export default class RecordedHistoryDB implements IRecordedHistoryDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * 1件挿入
     * @param program: RecordedHistory
     * @return Promise<apid.RecordedHistoryId> inserted id
     */
    public async insertOnce(program: RecordedHistory): Promise<apid.RecordedHistoryId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(RecordedHistory).values(program);

        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * 指定した時刻より古い番組を削除
     * @param time: apid.UnixtimeMS
     */
    public async delete(time: apid.UnixtimeMS): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .delete()
            .from(RecordedHistory)
            .where('endAt <= :time', { time: time });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }
}
