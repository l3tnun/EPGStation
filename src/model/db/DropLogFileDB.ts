import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import DropLogFile from '../../db/entities/DropLogFile';
import IDBOperator from './IDBOperator';
import IDropLogFileDB, { UpdateCntOption } from './IDropLogFileDB';

@injectable()
export default class DropLogFileDB implements IDropLogFileDB {
    private op: IDBOperator;

    constructor(@inject('IDBOperator') op: IDBOperator) {
        this.op = op;
    }

    /**
     * ドロップログ情報を 1 件挿入
     * @param dropLogFile: DropLogFile
     * @return Promise<apid.DropLogFileId> inserted id
     */
    public async insertOnce(dropLogFile: DropLogFile): Promise<apid.DropLogFileId> {
        const connection = await this.op.getConnection();
        const insertedResult = await connection
            .createQueryBuilder()
            .insert()
            .into(DropLogFile)
            .values(dropLogFile)
            .execute();

        return insertedResult.identifiers[0].id;
    }

    /**
     * ドロップカウント数更新
     * @param updateOption: UpdateCntOption
     * @return Promise<void>
     */
    public async updateCnt(updateOption: UpdateCntOption): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .update(DropLogFile)
            .set({
                errorCnt: updateOption.errorCnt,
                dropCnt: updateOption.dropCnt,
                scramblingCnt: updateOption.scramblingCnt,
            })
            .where({ id: updateOption.id })
            .execute();
    }

    /**
     * 指定したドロップログ情報を 1 件削除
     * @param dropLogFileId: apid.DropLogFileId
     * @return Promise<void>
     */
    public async deleteOnce(dropLogFileId: apid.DropLogFileId): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(DropLogFile)
            .where({
                id: dropLogFileId,
            })
            .execute();
    }

    /**
     * id を指定して取得する
     * @param dropLogFileId: apid.DropLogFileId
     * @return Promise<DropLogFile | null>
     */
    public async findId(dropLogFileId: apid.DropLogFileId): Promise<DropLogFile | null> {
        const connection = await this.op.getConnection();
        const result = await connection
            .getRepository(DropLogFile)
            .createQueryBuilder()
            .where({
                id: dropLogFileId,
            })
            .getOne();

        return typeof result === 'undefined' ? null : result;
    }
}
