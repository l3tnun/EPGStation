import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import RecordedHistory from '../../db/entities/RecordedHistory';
import IDBOperator from './IDBOperator';
import IRecordedHistoryDB from './IRecordedHistoryDB';

@injectable()
export default class RecordedHistoryDB implements IRecordedHistoryDB {
    private op: IDBOperator;

    constructor(@inject('IDBOperator') op: IDBOperator) {
        this.op = op;
    }

    /**
     * 1件挿入
     * @param program: RecordedHistory
     * @return Promise<apid.RecordedHistoryId> inserted id
     */
    public async insertOnce(program: RecordedHistory): Promise<apid.RecordedHistoryId> {
        const connection = await this.op.getConnection();
        const insertedResult = await connection
            .createQueryBuilder()
            .insert()
            .into(RecordedHistory)
            .values(program)
            .execute();

        return insertedResult.identifiers[0].id;
    }

    /**
     * 指定した時刻より古い番組を削除
     * @param time: apid.UnixtimeMS
     */
    public async delete(time: apid.UnixtimeMS): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(RecordedHistory)
            .where('endAt <= :time', { time: time })
            .execute();
    }
}
