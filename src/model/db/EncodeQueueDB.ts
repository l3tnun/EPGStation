import { inject, injectable } from 'inversify';
import EncodeQueue from '../../db/entities/EncodeQueue.js';
import ILoggerModel from '../ILoggerModel.js';
import IPromiseRetry from '../IPromiseRetry.js';
import IDBOperator from './IDBOperator.js';
import IEncodeQueueDB, { EncodeQueueRow } from './IEncodeQueueDB.js';

/** `IEncodeQueueDB` の実装。詳細は `IEncodeQueueDB` を参照。 */
@injectable()
export default class EncodeQueueDB implements IEncodeQueueDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    /**
     * 引数の並びはほかの DB class（`DropLogFileDB` など）と揃える。この class は log を出さないので
     * `ILoggerModel` は受け取るだけで使わない。
     */
    constructor(
        @inject('ILoggerModel') _logger: ILoggerModel,
        @inject('IDBOperator') op: IDBOperator,
        @inject('IPromiseRetry') promieRetry: IPromiseRetry,
    ) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * 依頼の記録を 1 件挿入する
     * @param row: EncodeQueueRow
     * @return Promise<void>
     */
    public async insertOnce(row: EncodeQueueRow): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(EncodeQueue).values({
            id: row.id,
            option: row.option,
            outputPath: row.outputPath,
            createdAt: row.createdAt,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 記録の出力先を更新する
     * @param id: 識別番号
     * @param outputPath: 出力ファイルの full path
     * @return Promise<boolean> 更新された行が存在するなら true
     */
    public async updateOutputPath(id: number, outputPath: string): Promise<boolean> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(EncodeQueue)
            .set({ outputPath: outputPath })
            .where({ id: id });

        const result = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return (result.affected ?? 0) > 0;
    }

    /**
     * 依頼の記録を 1 件削除する
     * @param id: 識別番号
     * @return Promise<boolean> 削除された行が存在するなら true
     */
    public async deleteOnce(id: number): Promise<boolean> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(EncodeQueue).where({ id: id });

        const result = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return (result.affected ?? 0) > 0;
    }

    /**
     * 依頼の記録をすべて削除する
     * @return Promise<void>
     */
    public async deleteAll(): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(EncodeQueue);

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 依頼の記録を識別番号の昇順ですべて取得する。
     * MySQL の bigint が文字列で返る場合も数値へ戻す。
     * @return Promise<EncodeQueueRow[]>
     */
    public async findAll(): Promise<EncodeQueueRow[]> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .getRepository(EncodeQueue)
            .createQueryBuilder('encodeQueue')
            .orderBy('encodeQueue.id', 'ASC');

        const rows = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return rows.map(row => {
            return {
                id: Number(row.id),
                option: row.option,
                outputPath: row.outputPath,
                createdAt: Number(row.createdAt),
            };
        });
    }
}
