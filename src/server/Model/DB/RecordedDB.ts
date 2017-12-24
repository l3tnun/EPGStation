import DBBase from './DBBase';
import * as path from 'path';
import * as DBSchema from './DBSchema';
import Util from '../../Util/Util';
import StrUtil from '../../Util/StrUtil';

interface findAllOption {
    limit?: number;
    offset?: number;
    query?: findQuery;
    isAddBaseDir?: boolean;
}

interface findQuery {
    ruleId?: number | null,
    genre1?: number,
    channelId?: number,
    keyword?: string,
}

interface RecordedDBInterface extends DBBase {
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
    findId(id: number): Promise<DBSchema.RecordedSchema | null>;
    findOld():  Promise<DBSchema.RecordedSchema | null>;
    findAll(option: findAllOption): Promise<DBSchema.RecordedSchema[]>;
    getTotal(option?: findQuery): Promise<number>;
    getRuleTag(): Promise<DBSchema.RuleTag[]>;
    getChannelTag(): Promise<DBSchema.ChannelTag[]>;
    getGenreTag(): Promise<DBSchema.GenreTag[]>;
}

abstract class RecordedDB extends DBBase implements RecordedDBInterface {
    /**
    * create table
    * @return Promise<void>
    */
    abstract create(): Promise<void>;

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
        let query = `insert into ${ DBSchema.TableName.Recorded } (`
            + this.createInsertColumnStr(false)
        + ') VALUES ('
            + this.operator.createValueStr(1, 21)
        + `) ${ this.operator.getReturningStr() }`;

        const baseDir = Util.getRecordedPath();

        let value: any[] = [];
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
            + 'recording '
    }

    /**
    * restore
    * @param program: DBSchema.RecordedSchema[]
    * @param isDelete: boolean
    * @param hasBaseDir: boolean
    */
    public restore(programs: DBSchema.RecordedSchema[], isDelete: boolean = true, hasBaseDir: boolean = true): Promise<void> {
        let query = `insert into ${ DBSchema.TableName.Recorded } (`
            + this.createInsertColumnStr(true)
        + ') VALUES ('
            + this.operator.createValueStr(1, 22)
        + `)`;

        const baseDir = Util.getRecordedPath();

        let values: any[] = [];
        for(let program of programs) {
            let value: any[] = [];

            let recPath = program.recPath === null ? null : program.recPath;
            if(recPath !== null && hasBaseDir) {
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

            values.push({query: query, values: value });
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
            + this.operator.createValueStr(1, 22)
        + ')'

        if(!isReplace) {
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
                + 'recording = excluded.recording '
        }

        const baseDir = Util.getRecordedPath();

        let value: any[] = [];
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
        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set recPath = null where id = ${ id }`);
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
        let thumbnailDir = Util.getThumbnailPath();
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
    * id 検索
    * @param id: recorded id
    * @return Promise<DBSchema.RecordedSchema | null>
    */
    public async findId(id: number): Promise<DBSchema.RecordedSchema | null> {
        let programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Recorded } where id = ${ id }`);
        return this.operator.getFirst(await this.fixResults(<DBSchema.RecordedSchema[]>programs));
    }

    /**
    * @param programs: DBSchema.RecordedSchema[]
    * @param isAddBaseDir: boolean = false
    */
    protected fixResults(programs: DBSchema.RecordedSchema[], isAddBaseDir: boolean = true): DBSchema.RecordedSchema[] {
        let baseDir = Util.getRecordedPath();
        let thumbnailDir = Util.getThumbnailPath();
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
        if(isAddBaseDir && program.recPath !== null) {
            //フルパスへ書き換える
            program.recPath = path.join(baseDir, program.recPath);
        }

        if(isAddBaseDir && program.thumbnailPath !== null) {
            //フルパスへ書き換える
            program.thumbnailPath = path.join(thumbnailDir, program.thumbnailPath);
        }

        return program;
    }

    /**
    * id が一番古いレコードを返す
    * @return Promise<DBSchema.RecordedSchema | null>
    */
    public async findOld(): Promise<DBSchema.RecordedSchema | null> {
        let programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Recorded } order by id asc ${ this.operator.createLimitStr(1) }`);
        return this.operator.getFirst(await this.fixResults(<DBSchema.RecordedSchema[]>programs));
    }

    /**
    * 全件取得
    * @param option: findAllOption
    * @return Promise<DBSchema.RecordedSchema[]>
    */
    public async findAll(option: findAllOption): Promise<DBSchema.RecordedSchema[]> {
        let query = `select ${ this.getAllColumns() } from ${ DBSchema.TableName.Recorded } `;

        if(typeof option.query !== 'undefined') {
            query += this.buildFindQuery(option.query || {});
        }

        query += ` order by id desc`;

        if(typeof option.limit !== 'undefined') {
            query += ` ${ this.operator.createLimitStr(option.limit, option.offset || 0) }`;
        }

        let programs = await this.operator.runQuery(query);
        return this.fixResults(<DBSchema.RecordedSchema[]>programs, option.isAddBaseDir);
    }

    /**
    * findQuery を組み立てる
    * @param findQuery
    * @return string
    */
    private buildFindQuery(option: findQuery): string {
        let query: string[] = [];

        if(typeof option.ruleId !== 'undefined') {
            query.push(option.ruleId === null ? 'ruleId is null' : `ruleId = ${ option.ruleId }`);
        }

        if(typeof option.genre1 !== 'undefined') {
            query.push(`genre1 = ${ option.genre1 }`);
        }

        if(typeof option.channelId !== 'undefined') {
            query.push(`channelId = ${ option.channelId }`);
        }

        if(typeof option.keyword !== 'undefined') {
            let keyword = option.keyword.replace(/'/g, "\\'"); // ' を \' へ置換
            StrUtil.toHalf(keyword).trim().split(' ').forEach((str) => {
                let baseStr = `'%${ str }%'`;
                query.push(`(name ${ this.createLikeStr() } ${ baseStr } or description ${ this.createLikeStr() } ${ baseStr })`);
            });
        }

        let str = '';
        if(query.length > 0) {
            str += ' where';
            query.forEach((q, i) => {
                str += ` ${ q }`;
                if(i < query.length - 1) {
                    str += ' and'
                }
            });
        }

        return str;
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
    public getTotal(option: findQuery = {}): Promise<number> {
        return this.operator.total(DBSchema.TableName.Recorded, this.buildFindQuery(option));
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

export { findQuery, RecordedDBInterface, RecordedDB };

