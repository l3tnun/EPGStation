import { inject, injectable } from 'inversify';
import type * as apid from '../../../api.js';
import DropLogFile from '../../db/entities/DropLogFile.js';
import Recorded from '../../db/entities/Recorded.js';
import Thumbnail from '../../db/entities/Thumbnail.js';
import VideoFile from '../../db/entities/VideoFile.js';
import IPromiseRetry from '../IPromiseRetry.js';
import IDBOperator from './IDBOperator.js';
import IDropLogFileDB, { UpdateCntOption } from './IDropLogFileDB.js';

/** `IDropLogFileDB` の実装。詳細は `IDropLogFileDB` を参照。 */
@injectable()
export default class DropLogFileDB implements IDropLogFileDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: DropLogFile[]
     * @return Promise<void>
     */
    public async restore(items: DropLogFile[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        let hasError = false;
        try {
            // start transaction
            await queryRunner.startTransaction();

            // 削除
            await queryRunner.manager.createQueryBuilder().delete().from(Thumbnail).execute();
            await queryRunner.manager.createQueryBuilder().delete().from(VideoFile).execute();
            await queryRunner.manager.createQueryBuilder().delete().from(Recorded).execute();
            await queryRunner.manager.createQueryBuilder().delete().from(DropLogFile).execute();

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(DropLogFile, item);
            }
            await queryRunner.commitTransaction();
        } catch (err: any) {
            console.error(err);
            hasError = true;
            if (queryRunner.isTransactionActive) {
                try {
                    await queryRunner.rollbackTransaction();
                } catch (cleanupError) {
                    console.error(cleanupError);
                }
            }
        } finally {
            try {
                await queryRunner.release();
            } catch (cleanupError) {
                console.error(cleanupError);
                hasError = true;
            }
        }

        if (hasError) {
            throw new Error('restore error');
        }
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
     * @return Promise<boolean> 削除された行が存在するなら true
     */
    public async deleteOnce(dropLogFileId: apid.DropLogFileId): Promise<boolean> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(DropLogFile).where({
            id: dropLogFileId,
        });

        const result = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return (result.affected ?? 0) > 0;
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

    /**
     * 全てのドロップログファイル情報を取得
     * @return Promise<DropLogFile[]>
     */
    public async findAll(): Promise<DropLogFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(DropLogFile).createQueryBuilder();

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }
}
