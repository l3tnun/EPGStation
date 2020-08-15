import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import DropLogFile from '../../db/entities/DropLogFile';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IDropLogFileDB, { UpdateCntOption } from './IDropLogFileDB';

@injectable()
export default class DropLogFileDB implements IDropLogFileDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * ドロップログ情報を 1 件挿入
     * @param dropLogFile: DropLogFile
     * @return Promise<apid.DropLogFileId> inserted id
     */
    public async insertOnce(dropLogFile: DropLogFile): Promise<apid.DropLogFileId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(DropLogFile).values(dropLogFile);

        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * ドロップカウント数更新
     * @param updateOption: UpdateCntOption
     * @return Promise<void>
     */
    public async updateCnt(updateOption: UpdateCntOption): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(DropLogFile)
            .set({
                errorCnt: updateOption.errorCnt,
                dropCnt: updateOption.dropCnt,
                scramblingCnt: updateOption.scramblingCnt,
            })
            .where({ id: updateOption.id });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定したドロップログ情報を 1 件削除
     * @param dropLogFileId: apid.DropLogFileId
     * @return Promise<void>
     */
    public async deleteOnce(dropLogFileId: apid.DropLogFileId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(DropLogFile).where({
            id: dropLogFileId,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して取得する
     * @param dropLogFileId: apid.DropLogFileId
     * @return Promise<DropLogFile | null>
     */
    public async findId(dropLogFileId: apid.DropLogFileId): Promise<DropLogFile | null> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.getRepository(DropLogFile).createQueryBuilder().where({
            id: dropLogFileId,
        });
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }
}
