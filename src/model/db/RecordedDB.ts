import { inject, injectable } from 'inversify';
import { In, IsNull, Not } from 'typeorm';
import type * as apid from '../../../api.js';
import Recorded from '../../db/entities/Recorded.js';
import Thumbnail from '../../db/entities/Thumbnail.js';
import VideoFile from '../../db/entities/VideoFile.js';
import StrUtil from '../../util/StrUtil.js';
import { StorageDeletionCandidateRequest } from '../operator/storage/IStorageDeletionCandidatePort.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IPromiseRetry from '../IPromiseRetry.js';
import DBUtil from './DBUtil.js';
import IDBOperator from './IDBOperator.js';
import IRecordedDB, { FindAllOption, RecordedColumnOption } from './IRecordedDB.js';

/** `IRecordedDB` の実装。詳細は `IRecordedDB` を参照。 */
@injectable()
export default class RecordedDB implements IRecordedDB {
    private log: ILogger;
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IDBOperator') op: IDBOperator,
        @inject('IPromiseRetry') promieRetry: IPromiseRetry,
    ) {
        this.log = logger.getLogger();
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: Recorded[]
     * @return Promise<void>
     */
    public async restore(items: Recorded[]): Promise<void> {
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

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(Recorded, item);
            }
            await queryRunner.commitTransaction();
        } catch (err: any) {
            this.log.system.error(err);
            hasError = true;
            if (queryRunner.isTransactionActive) {
                try {
                    await queryRunner.rollbackTransaction();
                } catch (cleanupError) {
                    this.log.system.error(cleanupError);
                }
            }
        } finally {
            try {
                await queryRunner.release();
            } catch (cleanupError) {
                this.log.system.error(cleanupError);
                hasError = true;
            }
        }

        if (hasError) {
            throw new Error('restore error');
        }
    }

    /**
     * 録画番組情報を 1 件挿入
     * @param recorded: Recorded
     * @return inserted id
     */
    public async insertOnce(recorded: Recorded): Promise<apid.RecordedId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(Recorded).values(recorded);
        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * 録画番組情報の更新
     * @param recorded: Recorded
     * @return Promise<void>
     */
    public async updateOnce(recorded: Recorded): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().update(Recorded).set(recorded).where({ id: recorded.id });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画情報の isRecording を false に
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async removeRecording(recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }

        // すでに有効か
        if (recorded.isRecording === false) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                isRecording: false,
            })
            .where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した drop log file id を削除する
     * @param dropLogFileId: apid,DropLogFileId
     * @return Promise<boolean> 変更された行が存在するなら true
     */
    public async removeDropLogFileId(dropLogFileId: apid.DropLogFileId): Promise<boolean> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                dropLogFileId: null,
            })
            .where({ dropLogFileId: dropLogFileId });
        const result = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return (result.affected ?? 0) > 0;
    }

    /**
     * 指定した ruleId を削除する
     * @param ruleId: apid.RuleId
     * @return Promise<void>
     */
    public async removeRuleId(ruleId: apid.RuleId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                ruleId: null,
            })
            .where({ ruleId: ruleId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public async changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }

        // すでに同じ状態であれば何もしない
        if (recorded.isProtected === isProtect) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                isProtected: isProtect,
            })
            .where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画番組情報を 1 件削除
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteOnce(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(Recorded).where({
            id: recordedId,
        });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して録画番組情報取得
     * @param recordedId: apid.RecordedId
     * @return Recorded
     */
    public async findId(recordedId: apid.RecordedId): Promise<Recorded | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: recordedId })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result.length === 0 ? null : result[0];
    }

    /**
     * id を複数指定して番組情報を取得する
     * @param recordedIds: apid.RecordedId[]
     * @return Promise<Recorded[]>
     */
    public async findIds(
        recordedIds: apid.RecordedId[],
        columnOption?: RecordedColumnOption,
        isReverse?: boolean,
    ): Promise<Recorded[]> {
        if (recordedIds.length === 0) {
            return [];
        }

        const connection = await this.op.getConnection();

        let queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: In(recordedIds) });

        if (typeof columnOption === 'undefined') {
            queryBuilder = queryBuilder
                .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
                .leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
        } else {
            // videoFile
            if (columnOption.isNeedVideoFiles === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.videoFiles', 'videoFiles');
            }
            // thumbnail
            if (columnOption.isNeedThumbnails === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
            }
            // dropLogFile
            if (columnOption.isNeedsDropLog === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile');
            }

            // tags
            if (columnOption.isNeedTags === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.tags', 'tags');
            }
        }

        queryBuilder = queryBuilder.orderBy('recorded.startAt', isReverse ? 'ASC' : 'DESC');

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result;
    }

    /**
     * 全件取得
     * @param option: FindAllOption
     * @param columnOption: RecordedColumnOption
     * @return Promise<[Recorded[], number]>
     */
    public async findAll(option: FindAllOption, columnOption: RecordedColumnOption): Promise<[Recorded[], number]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection.getRepository(Recorded).createQueryBuilder('recorded');

        const querys: { query: string; values: any }[] = [];

        // is recording
        if (typeof option.isRecording !== 'undefined') {
            querys.push({
                query: 'recorded.isRecording = :isRecording',
                values: {
                    isRecording: option.isRecording,
                },
            });
        }

        // rule id
        if (typeof option.ruleId !== 'undefined') {
            if (option.ruleId === 0) {
                querys.push({
                    query: 'recorded.ruleId is null',
                    values: {},
                });
            } else {
                querys.push({
                    query: 'recorded.ruleId = :ruleId',
                    values: {
                        ruleId: option.ruleId,
                    },
                });
            }
        }

        // channel id
        if (typeof option.channelId !== 'undefined') {
            querys.push({
                query: 'recorded.channelId = :channelId',
                values: {
                    channelId: option.channelId,
                },
            });
        }

        // genre
        if (typeof option.genre !== 'undefined') {
            querys.push({
                query: '(genre1 = :genre or genre2 = :genre or genre3 = :genre)',
                values: {
                    genre: option.genre,
                },
            });
        }

        // keyword
        if (typeof option.keyword !== 'undefined') {
            const keywords = StrUtil.toHalf(option.keyword).split(/ /);
            const like = this.op.getLikeStr(false);
            const valueBaseName = 'keyword';

            const nameAnd: string[] = [];
            const descriptionAnd: string[] = [];
            const values: any = {};
            keywords.forEach((str, i) => {
                str = `%${str}%`;

                // value
                const valueName = `${valueBaseName}Name${i}`;
                values[valueName] = str;

                // name
                nameAnd.push(`halfWidthName ${like} :${valueName}`);
                // description
                descriptionAnd.push(`halfWidthDescription ${like} :${valueName}`);
            });

            const or: string[] = [];
            if (nameAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(nameAnd)})`);
            }
            if (descriptionAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(descriptionAnd)})`);
            }

            querys.push({
                query: DBUtil.createOrQuery(or),
                values: values,
            });
        }

        // オリジナルファイルだけを抽出する
        if (columnOption.isNeedVideoFiles === true && !!option.hasOriginalFile === true) {
            querys.push({
                query: 'videoFiles.type <> :type',
                values: {
                    type: 'encoded',
                },
            });
        }

        // where セット
        for (const q of querys) {
            queryBuilder = queryBuilder.andWhere(q.query, q.values);
        }

        // offset・limit
        // limit 0 は件数の制限なし（TypeORM 1.x の `take(0)` は `LIMIT 0` になるため take を付けない）
        const pagination = DBUtil.resolvePagination(option);
        if (typeof pagination.skip !== 'undefined') {
            queryBuilder.skip(pagination.skip);
        }
        if (typeof pagination.take !== 'undefined') {
            queryBuilder.take(pagination.take);
        }

        // order by
        queryBuilder = queryBuilder.orderBy('recorded.startAt', option.isReverse ? 'ASC' : 'DESC');

        // videoFiles
        if (columnOption.isNeedVideoFiles === true) {
            queryBuilder = queryBuilder.leftJoinAndSelect('recorded.videoFiles', 'videoFiles');
        }

        if (!!option.hasOriginalFile === false) {
            // thumbnails
            if (columnOption.isNeedThumbnails === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
            }

            // dropLogFile
            if (columnOption.isNeedsDropLog === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile');
            }

            // tags
            if (columnOption.isNeedTags === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.tags', 'tags');
            }

            return await this.promieRetry.run(() => {
                return queryBuilder.getManyAndCount();
            });
        } else {
            // option.hasOriginalFile が有効な場合は エンコード済みビデオを取得できないので id を指定して再取得する
            const [records, total] = await this.promieRetry.run(() => {
                return queryBuilder.getManyAndCount();
            });

            const recordedIds = records.map(r => {
                return r.id;
            });

            const result = await this.promieRetry.run(() => {
                return this.findIds(recordedIds, columnOption, option.isReverse);
            });

            return [result, total];
        }
    }

    /**
     * channelIdのリストを返す
     * @return Promise<apid.RecordedChannelListItem[]>
     */
    public async findChannelList(): Promise<apid.RecordedChannelListItem[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .select('count(*) as cnt, channelId')
            .groupBy('channelId');

        return await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });
    }

    /**
     * genreのリストを返す
     * @return Promise<apid.RecordedGenreListItem[]>
     */
    public async findGenreList(): Promise<apid.RecordedGenreListItem[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .select('count(*) as cnt, genre1 as genre')
            .where({ genre1: Not(IsNull()) })
            .groupBy('genre');

        return await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });
    }

    /**
     * 一番古い番組を返す
     * @return Promise<Recorded | null>
     */
    public async findOld(): Promise<Recorded | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({
                isProtected: false,
            })
            .orderBy('recorded.startAt', 'ASC')
            .orderBy('recorded.id', 'ASC')
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 保存先に属する未保護かつ未使用の最古録画 ID を返す
     */
    public async findOldestUnused(request: StorageDeletionCandidateRequest): Promise<apid.RecordedId | null> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.getRepository(Recorded).createQueryBuilder('recorded');
        const storageNameOperand =
            connection.options.type === 'mysql'
                ? (alias: string): string => `CAST(${alias}.parentDirectoryName AS BINARY)`
                : (alias: string): string => `CAST(${alias}.parentDirectoryName AS BLOB)`;
        const storageNameParameter =
            connection.options.type === 'mysql' ? 'CAST(:storageName AS BINARY)' : 'CAST(:storageName AS BLOB)';
        const matchingVideo = queryBuilder
            .subQuery()
            .from(VideoFile, 'matchingVideo')
            .where('matchingVideo.recordedId = recorded.id')
            .andWhere(`${storageNameOperand('matchingVideo')} = ${storageNameParameter}`)
            .getQuery();
        const mismatchingVideo = queryBuilder
            .subQuery()
            .from(VideoFile, 'mismatchingVideo')
            .where('mismatchingVideo.recordedId = recorded.id')
            .andWhere(`${storageNameOperand('mismatchingVideo')} <> ${storageNameParameter}`)
            .getQuery();

        queryBuilder
            .select('recorded.id', 'id')
            .where('recorded.isProtected = :isProtected', {
                isProtected: this.op.convertBoolean(false),
            })
            .andWhere(`EXISTS ${matchingVideo}`, { storageName: request.storageName })
            .andWhere(`NOT EXISTS ${mismatchingVideo}`);
        if (request.excludedRecordedIds.size > 0) {
            queryBuilder.andWhere('recorded.id NOT IN (:...excludedRecordedIds)', {
                excludedRecordedIds: [...request.excludedRecordedIds],
            });
        }
        queryBuilder.orderBy('recorded.startAt', 'ASC').addOrderBy('recorded.id', 'ASC').take(1);

        const result = await this.promieRetry.run(() => queryBuilder.getRawOne<{ id: apid.RecordedId }>());
        return typeof result === 'undefined' ? null : result.id;
    }

    /**
     * 指定した reserveId の録画を返す
     * @param reserveId: apid.ReserveId
     * @return Promise<Recorded[]>
     */
    public async findReserveId(reserveId: apid.ReserveId): Promise<Recorded[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ reserveId: reserveId })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }
}
