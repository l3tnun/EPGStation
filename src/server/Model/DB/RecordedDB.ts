import * as path from 'path';
import FileUtil from '../../Util/FileUtil';
import StrUtil from '../../Util/StrUtil';
import Util from '../../Util/Util';
import * as DBSchema from './DBSchema';
import DBTableBase from './DBTableBase';

interface FindAllOption {
    limit?: number;
    offset?: number;
    query?: FindQuery;
    isAddBaseDir?: boolean;
}

interface FindQuery {
    ruleId?: number | null;
    genre1?: number;
    channelId?: number;
    keyword?: string;
}

interface RecordedDBInterface extends DBTableBase {
    create(): Promise<void>;
    drop(): Promise<void>;
    insert(program: DBSchema.RecordedSchema): Promise<number>;
    restore(programs: DBSchema.RecordedSchema[], isDelete?: boolean, hasBaseDir?: boolean): Promise<void>;
    replace(program: DBSchema.RecordedSchema): Promise<void>;
    delete(id: number): Promise<void>;
    deleteRecPath(id: number): Promise<void>;
    deleteRuleId(ruleId: number): Promise<void>;
    addThumbnail(id: number, filePath: string): Promise<void>;
    removeRecording(id: number): Promise<void>;
    removeAllRecording(): Promise<void>;
    updateTsFilePath(recordedId: number, filePath: string): Promise<void>;
    updateFileSize(recordedId: number): Promise<void>;
    updateAllNullFileSize(): Promise<void>;
    findId(id: number): Promise<DBSchema.RecordedSchema | null>;
    findOld(): Promise<DBSchema.RecordedSchema | null>;
    findAll(option: FindAllOption): Promise<DBSchema.RecordedSchema[]>;
    getTotal(option?: FindQuery): Promise<number>;
    getRuleTag(): Promise<DBSchema.RuleTag[]>;
    getChannelTag(): Promise<DBSchema.ChannelTag[]>;
    getGenreTag(): Promise<DBSchema.GenreTag[]>;
}

abstract class RecordedDB extends DBTableBase implements RecordedDBInterface {
    /**
     * get table name
     * @return string
     */
    protected getTableName(): string {
        return DBSchema.TableName.Recorded;
    }

    /**
     * create table
     * @return Promise<void>
     */
    public abstract create(): Promise<void>;

    /**
     * drop table
     */
    public drop(): Promise<void> {
        return this.operator.runQuery(`drop table if exists ${ DBSchema.TableName.Recorded }`);
    }


    /**
     * recorded 挿入
     * @param program: DBSchema.RecordedSchema
     * @param Promise<number> insertId
     */
    public insert(program: DBSchema.RecordedSchema): Promise<number> {
        const query = `insert into ${ DBSchema.TableName.Recorded } (`
            + this.createInsertColumnStr(false)
        + ') VALUES ('
            + this.operator.createValueStr(1, 23)
        + `) ${ this.operator.getReturningStr() }`;

        const baseDir = Util.getRecordedPath();

        const value: any[] = [];
        value.push(program.programId);
        value.push(program.channelId);
        value.push(program.channelType);
        value.push(program.startAt);
        value.push(program.endAt);
        value.push(program.duration);
        value.push(program.name);
        value.push(program.description);
        value.push(program.extended);
        value.push(program.genre1);
        value.push(program.genre2);
        value.push(program.videoType);
        value.push(program.videoResolution);
        value.push(program.videoStreamContent);
        value.push(program.videoComponentType);
        value.push(program.audioSamplingRate);
        value.push(program.audioComponentType);
        value.push(program.recPath === null ? null : program.recPath.slice(baseDir.length + path.sep.length));
        value.push(program.ruleId);
        value.push(program.thumbnailPath);
        value.push(program.recording);
        value.push(program.protection);
        value.push(program.filesize);

        return this.operator.runInsert(query, value);
    }

    /**
     * insert 時のカラムを生成
     * @param hasId: boolean
     * @return string
     */
    private createInsertColumnStr(hasId: boolean): string {
        return (hasId ? 'id, ' : '')
            + 'programId, '
            + 'channelId, '
            + 'channelType, '
            + 'startAt, '
            + 'endAt, '
            + 'duration, '
            + 'name, '
            + 'description, '
            + 'extended, '
            + 'genre1, '
            + 'genre2, '
            + 'videoType, '
            + 'videoResolution, '
            + 'videoStreamContent, '
            + 'videoComponentType, '
            + 'audioSamplingRate, '
            + 'audioComponentType, '
            + 'recPath, '
            + 'ruleId, '
            + 'thumbnailPath, '
            + 'recording, '
            + 'protection, '
            + 'filesize ';
    }

    /**
     * restore
     * @param program: DBSchema.RecordedSchema[]
     * @param isDelete: boolean
     * @param hasBaseDir: boolean
     */
    public restore(programs: DBSchema.RecordedSchema[], isDelete: boolean = true, hasBaseDir: boolean = true): Promise<void> {
        const query = `insert into ${ DBSchema.TableName.Recorded } (`
            + this.createInsertColumnStr(true)
        + ') VALUES ('
            + this.operator.createValueStr(1, 24)
        + ')';

        const baseDir = Util.getRecordedPath();

        const values: any[] = [];
        for (const program of programs) {
            const value: any[] = [];

            let recPath = program.recPath === null ? null : program.recPath;
            if (recPath !== null && hasBaseDir) {
                recPath = recPath.slice(baseDir.length + path.sep.length);
            }

            value.push(program.id);
            value.push(program.programId);
            value.push(program.channelId);
            value.push(program.channelType);
            value.push(program.startAt);
            value.push(program.endAt);
            value.push(program.duration);
            value.push(program.name);
            value.push(program.description);
            value.push(program.extended);
            value.push(program.genre1);
            value.push(program.genre2);
            value.push(program.videoType);
            value.push(program.videoResolution);
            value.push(program.videoStreamContent);
            value.push(program.videoComponentType);
            value.push(program.audioSamplingRate);
            value.push(program.audioComponentType);
            value.push(recPath);
            value.push(program.ruleId);
            value.push(program.thumbnailPath);
            value.push(program.recording);
            value.push(program.protection);
            value.push(program.filesize);

            values.push({ query: query, values: value });
        }


        return this.operator.manyInsert(DBSchema.TableName.Recorded, values, isDelete);
    }

    /**
     * recorded 更新
     * @param program: DBSchema.RecordedSchema
     * @param Promise<void>
     */
    public async replace(program: DBSchema.RecordedSchema): Promise<void> {
        const isReplace = this.operator.getUpsertType() === 'replace';
        let query = `${ isReplace ? 'replace' : 'insert' } into ${ DBSchema.TableName.Recorded } (`
            + this.createInsertColumnStr(true)
        + ') VALUES ('
            + this.operator.createValueStr(1, 24)
        + ')';

        if (!isReplace) {
            query += ' on conflict (id) do update set '
                + 'programId = excluded.programId, '
                + 'channelId = excluded.channelId, '
                + 'channelType = excluded.channelType, '
                + 'startAt = excluded.startAt, '
                + 'endAt = excluded.endAt, '
                + 'duration = excluded.duration, '
                + 'name = excluded.name, '
                + 'description = excluded.description, '
                + 'extended = excluded.extended, '
                + 'genre1 = excluded.genre1, '
                + 'genre2 = excluded.genre2, '
                + 'videoType = excluded.videoType, '
                + 'videoResolution = excluded.videoResolution, '
                + 'videoStreamContent = excluded.videoStreamContent, '
                + 'videoComponentType = excluded.videoComponentType, '
                + 'audioSamplingRate = excluded.audioSamplingRate, '
                + 'audioComponentType = excluded.audioComponentType, '
                + 'recPath = excluded.recPath, '
                + 'ruleId = excluded.ruleId, '
                + 'thumbnailPath = excluded.thumbnailPath, '
                + 'recording = excluded.recording, '
                + 'protection = excluded.protection, '
                + 'filesize = excluded.filesize ';
        }

        const baseDir = Util.getRecordedPath();

        const value: any[] = [];
        value.push(program.id);
        value.push(program.programId);
        value.push(program.channelId);
        value.push(program.channelType);
        value.push(program.startAt);
        value.push(program.endAt);
        value.push(program.duration);
        value.push(program.name);
        value.push(program.description);
        value.push(program.extended);
        value.push(program.genre1);
        value.push(program.genre2);
        value.push(program.videoType);
        value.push(program.videoResolution);
        value.push(program.videoStreamContent);
        value.push(program.videoComponentType);
        value.push(program.audioSamplingRate);
        value.push(program.audioComponentType);
        value.push(program.recPath === null ? null : program.recPath.slice(baseDir.length + path.sep.length));
        value.push(program.ruleId);
        value.push(program.thumbnailPath);
        value.push(program.recording);
        value.push(program.protection);
        value.push(program.filesize);

        await this.operator.runQuery(query, value);
    }

    /**
     * recorded を削除
     * @param id: recorded id
     * @return Promise<void>
     */
    public delete(id: number): Promise<void> {
        return this.operator.runQuery(`delete from ${ DBSchema.TableName.Recorded } where id = ${ id }`);
    }

    /**
     * recPath を削除
     * @param id: recorded id
     * @return Promise<void>
     */
    public deleteRecPath(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set recPath = null, filesize = null where id = ${ id }`);
    }

    /**
     * ruleId を削除
     * @param ruleId: rule id
     * @return Promise<void>
     */
    public deleteRuleId(ruleId: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set ruleId = null where ruleId = ${ ruleId }`);
    }

    /**
     * thumbnail filePath を追加
     * @param id: recorded id
     * @param filePath: thumbnail path
     * @return Promise<void>
     */
    public addThumbnail(id: number, filePath: string): Promise<void> {
        const thumbnailDir = Util.getThumbnailPath();

        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set thumbnailPath = '${ filePath.slice(thumbnailDir.length + path.sep.length) }' where id = ${ id }`);
    }

    /**
     * recording 状態を解除する
     * @param id: recorded id
     * @return Promise<void>
     */
    public removeRecording(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set recording = false where id = ${ id }`);
    }

    /**
     * recording 状態をすべて解除する
     * @return Promise<void>
     */
    public removeAllRecording(): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set recording = false where recording = true`);
    }

    /**
     * recPath を更新する
     * @param recordedId: recorded id
     * @param filePath: file path
     * @return Promise<void>
     */
    public async updateTsFilePath(recordedId: number, filePath: string): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) { throw new Error('RecordedIsNotFound'); }

        const query = `update ${ DBSchema.TableName.Recorded } set recPath = ${ this.operator.createValueStr(1, 1) } where id = ${ recordedId }`;

        await this.operator.runQuery(query, [filePath.slice(Util.getRecordedPath().length + path.sep.length)]);
    }

    /**
     * filesize を更新する
     * @return Promise<void>
     */
    public async updateFileSize(recordedId: number): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null || recorded.recPath === null) { return; }

        const size = FileUtil.getFileSize(recorded.recPath);
        await this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set filesize = ${ size } where id = ${ recordedId }`);
    }

    /**
     * ファイルが存在して filesize が null のデータを更新する
     * @return Promise<void>
     */
    public async updateAllNullFileSize(): Promise<void> {
        let programs = <DBSchema.RecordedSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Recorded } where filesize is null and recPath is not null`);
        programs = await this.fixResults(programs);

        for (const program of programs) {
            try {
                const size = FileUtil.getFileSize(program.recPath!);
                await this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set filesize = ${ size } where id = ${ program.id }`);
            } catch (err) {
                this.log.system.warn(`${ program.recPath } update filesize error.`);
            }
        }
    }

    /**
     * id 検索
     * @param id: recorded id
     * @return Promise<DBSchema.RecordedSchema | null>
     */
    public async findId(id: number): Promise<DBSchema.RecordedSchema | null> {
        const programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Recorded } where id = ${ id }`);

        return this.operator.getFirst(await this.fixResults(<DBSchema.RecordedSchema[]> programs));
    }

    /**
     * @param programs: DBSchema.RecordedSchema[]
     * @param isAddBaseDir: boolean = false
     */
    protected fixResults(programs: DBSchema.RecordedSchema[], isAddBaseDir: boolean = true): DBSchema.RecordedSchema[] {
        const baseDir = Util.getRecordedPath();
        const thumbnailDir = Util.getThumbnailPath();

        return programs.map((program) => {
            return this.fixResult(baseDir, thumbnailDir, program, isAddBaseDir);
        });
    }

    /**
     * @param baseDir: string
     * @param thumbnailDir: string
     * @param program: DBSchema.RecordedSchema
     * @param isAddBaseDir: boolean
     * @return DBSchema.RecordedSchema
     */
    protected fixResult(baseDir: string, thumbnailDir: string, program: DBSchema.RecordedSchema, isAddBaseDir: boolean): DBSchema.RecordedSchema {
        if (isAddBaseDir && program.recPath !== null) {
            // フルパスへ書き換える
            program.recPath = path.join(baseDir, program.recPath);
        }

        if (isAddBaseDir && program.thumbnailPath !== null) {
            // フルパスへ書き換える
            program.thumbnailPath = path.join(thumbnailDir, program.thumbnailPath);
        }

        return program;
    }

    /**
     * id が一番古いレコードを返す
     * @return Promise<DBSchema.RecordedSchema | null>
     */
    public async findOld(): Promise<DBSchema.RecordedSchema | null> {
        const programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Recorded } order by startAt asc, id asc ${ this.operator.createLimitStr(1) }`);

        return this.operator.getFirst(await this.fixResults(<DBSchema.RecordedSchema[]> programs));
    }

    /**
     * 全件取得
     * @param option: FindAllOption
     * @return Promise<DBSchema.RecordedSchema[]>
     */
    public async findAll(option: FindAllOption): Promise<DBSchema.RecordedSchema[]> {
        let query = `select ${ this.getAllColumns() } from ${ DBSchema.TableName.Recorded } `;

        let values: any[] = [];
        if (typeof option.query !== 'undefined') {
            const findQuery = this.buildFindQuery(option.query || {});
            query += findQuery.query;
            values = findQuery.values;
        }

        query += ' order by startAt desc, id desc';

        if (typeof option.limit !== 'undefined') {
            query += ` ${ this.operator.createLimitStr(option.limit, option.offset || 0) }`;
        }

        const programs = await this.operator.runQuery(query, values);

        return this.fixResults(<DBSchema.RecordedSchema[]> programs, option.isAddBaseDir);
    }

    /**
     * FindQuery を組み立てる
     * @param FindQuery
     * @return { query: string; values: any[] }
     */
    private buildFindQuery(option: FindQuery): { query: string; values: any[] } {
        const query: string[] = [];
        const values: any[] = [];

        if (typeof option.ruleId !== 'undefined') {
            query.push(option.ruleId === null ? 'ruleId is null' : `ruleId = ${ option.ruleId }`);
        }

        if (typeof option.genre1 !== 'undefined') {
            query.push(`genre1 = ${ option.genre1 }`);
        }

        if (typeof option.channelId !== 'undefined') {
            query.push(`channelId = ${ option.channelId }`);
        }

        if (typeof option.keyword !== 'undefined') {
            StrUtil.toHalf(option.keyword).trim().split(' ').forEach((s) => {
                s = `%${ s }%`;
                const nameStr = `${ this.operator.createValueStr(values.length + 1, values.length + 1) }`;
                values.push(s);
                const descriptionStr = `${ this.operator.createValueStr(values.length + 1, values.length + 1) }`;
                values.push(s);
                query.push(`(name ${ this.createLikeStr() } ${ nameStr } or description ${ this.createLikeStr() } ${ descriptionStr })`);
            });
        }

        let str = '';
        if (query.length > 0) {
            str += ' where';
            query.forEach((q, i) => {
                str += ` ${ q }`;
                if (i < query.length - 1) {
                    str += ' and';
                }
            });
        }

        return { query: str, values: values };
    }

    /**
     * create like str
     */
    public createLikeStr(): string {
        return 'like';
    }

    /**
     * 件数取得
     * @return Promise<number>
     */
    public getTotal(option: FindQuery = {}): Promise<number> {
        const findQuery = this.buildFindQuery(option);

        return this.operator.total(DBSchema.TableName.Recorded, findQuery.query, findQuery.values);
    }

    /**
     * rule id 集計
     * @return Promise<DBSchema.RuleTag[]>
     */
    public getRuleTag(): Promise<DBSchema.RuleTag[]> {
        return this.getTag('ruleId');
    }

    /**
     * channel id 集計
     * @return Promise<DBSchema.ChannelTag[]>
     */
    public getChannelTag(): Promise<DBSchema.ChannelTag[]> {
        return this.getTag('channelId');
    }

    /**
     * genre1 集計
     * @return Promise<DBSchema.GenreTag[]>
     */
    public getGenreTag(): Promise<DBSchema.GenreTag[]> {
        return this.getTag('genre1');
    }

    /**
     * 指定した項目の集計
     * @return Promise<T>
     */
    protected getTag<T>(item: string): Promise<T> {
        return this.operator.runQuery(`select count(*) as cnt, ${ item } from ${ DBSchema.TableName.Recorded } group by ${ item } order by ${ item } asc`);
    }
}

export { FindQuery, RecordedDBInterface, RecordedDB };

