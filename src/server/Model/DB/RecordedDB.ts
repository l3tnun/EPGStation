import * as path from 'path';
import DBBase from './DBBase';
import * as DBSchema from './DBSchema';
import StrUtil from '../..//Util/StrUtil';
import Util from '../..//Util/Util';

interface findQuery {
    ruleId?: number | null,
    genre1?: number,
    channelId?: number,
    keyword?: string,
}

interface RecordedDBInterface extends DBBase {
    create(): Promise<void>;
    insert(program: DBSchema.RecordedSchema): Promise<any>;
    replace(program: DBSchema.RecordedSchema): Promise<any>;
    delete(id: number): Promise<void>;
    deleteRecPath(id: number): Promise<void>;
    deleteRuleId(ruleId: number): Promise<void>;
    addThumbnail(id: number, filePath: string): Promise<void>;
    removeRecording(id: number): Promise<void>;
    removeAllRecording(): Promise<void>;
    findId(id: number): Promise<DBSchema.RecordedSchema[]>;
    findOld():  Promise<DBSchema.RecordedSchema[]>;
    findAll(limit: number, offset: number, option?: findQuery): Promise<DBSchema.RecordedSchema[]>;
    getTotal(option?: findQuery): Promise<number>;
    getRuleTag(): Promise<DBSchema.RuleTag[]>;
    getChannelTag(): Promise<DBSchema.ChannelTag[]>;
    getGenreTag(): Promise<DBSchema.GenreTag[]>;
}

class RecordedDB extends DBBase implements RecordedDBInterface {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `CREATE TABLE IF NOT EXISTS ${ DBSchema.TableName.Recorded } (`
            + 'id int primary key auto_increment, '
            + 'programId bigint not null, '
            + 'channelId bigint not null, '
            + 'channelType text not null, '
            + 'startAt bigint not null, '
            + 'endAt bigint not null, '
            + 'duration bigint not null, '
            + 'name text not null, '
            + 'description text null, '
            + 'extended text null, '
            + 'genre1 integer null, '
            + 'genre2 integer null, '
            + 'videoType text null, '
            + 'videoResolution text null, '
            + 'videoStreamContent integer null, '
            + 'videoComponentType integer null, '
            + 'audioSamplingRate integer null, '
            + 'audioComponentType integer null, '
            + 'recPath text, '
            + 'ruleId int, '
            + 'thumbnailPath text, '
            + 'recording boolean '
        + ') engine=InnoDB;'

        return this.runQuery(query);
    }

    /**
    * recorded 挿入
    * @param program: DBSchema.RecordedSchema
    * @param Promise<any>
    */
    public insert(program: DBSchema.RecordedSchema): Promise<any> {
        let query = `insert into ${ DBSchema.TableName.Recorded } (`
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
        + ') VALUES ('
            + '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'
        + ');'

        let baseDir = Util.getRecordedPath();

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

        return this.runQuery(query, value);
    }

    /**
    * recorded 更新
    * @param program: DBSchema.RecordedSchema
    * @param Promise<any>
    */
    public replace(program: DBSchema.RecordedSchema): Promise<any> {
        let query = `replace into ${ DBSchema.TableName.Recorded } (`
            + 'id, '
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
        + ') VALUES ('
            + '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'
        + ');'

        let baseDir = Util.getRecordedPath();

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

        return this.runQuery(query, value);
    }

    /**
    * recorded を削除
    * @param id: recorded id
    * @return Promise<void>
    */
    public delete(id: number): Promise<void> {
        return this.runQuery(`delete from ${ DBSchema.TableName.Recorded } where id = ${ id }`);
    }

    /**
    * recPath を削除
    * @param id: recorded id
    * @return Promise<void>
    */
    public deleteRecPath(id: number): Promise<void> {
        return this.runQuery(`update ${ DBSchema.TableName.Recorded } set recPath = null where id = ${ id }`);
    }

    /**
    * ruleId を削除
    * @param ruleId: rule id
    * @return Promise<void>
    */
    public deleteRuleId(ruleId: number): Promise<void> {
        return this.runQuery(`update ${ DBSchema.TableName.Recorded } set ruleId = null where ruleId = ${ ruleId }`);
    }

    /**
    * thumbnail filePath を追加
    * @param id: recorded id
    * @param filePath: thumbnail path
    * @return Promise<void>
    */
    public addThumbnail(id: number, filePath: string): Promise<void> {
        let thumbnailDir = Util.getThumbnailPath();
        return this.runQuery(`update ${ DBSchema.TableName.Recorded } set thumbnailPath = '${ filePath.slice(thumbnailDir.length + path.sep.length) }' where id = ${ id }`);
    }
    /**
    * recording 状態を解除する
    * @param id: recorded id
    * @return Promise<void>
    */
    public removeRecording(id: number): Promise<void> {
        return this.runQuery(`update ${ DBSchema.TableName.Recorded } set recording = false where id = ${ id }`);
    }

    /**
    * recording 状態をすべて解除する
    * @return Promise<void>
    */
    public removeAllRecording(): Promise<void> {
        return this.runQuery(`update ${ DBSchema.TableName.Recorded } set recording = false where recording = ${ true }`);
    }

    /**
    * id 検索
    * @param id: recorded id
    * @return Promise<DBSchema.RecordedSchema[]>
    */
    public async findId(id: number): Promise<DBSchema.RecordedSchema[]> {
        let programs = await this.runQuery(`select * from ${ DBSchema.TableName.Recorded } where id = ${ id }`);
        return this.fixResult(<DBSchema.RecordedSchema[]>programs);
    }

    /**
    * recPath をフルパスへ書き換える
    * @param programs: DBSchema.RecordedSchema[]
    */
    private fixResult(programs: DBSchema.RecordedSchema[]): DBSchema.RecordedSchema[] {
        let baseDir = Util.getRecordedPath();
        let thumbnailDir = Util.getThumbnailPath();
        return programs.map((program) => {
            if(program.recPath !== null) {
                program.recPath = path.join(baseDir, program.recPath);
            }
            if(program.thumbnailPath !== null) {
                program.thumbnailPath = path.join(thumbnailDir, program.thumbnailPath);
            }
            return program;
        });
    }

    /**
    * id が一番古いレコードを返す
    * @return Promise<DBSchema.RecordedSchema[]>
    */
    public async findOld():  Promise<DBSchema.RecordedSchema[]> {
        let programs = await this.runQuery(`select * from ${ DBSchema.TableName.Recorded } order by id asc limit 1`);
        return this.fixResult(<DBSchema.RecordedSchema[]>programs);
    }

    /**
    * 全件取得
    * @param limit: limit
    * @param offset: offset
    * @param ruleId: rule id | null
    * @param genre: genre
    * @param channelId: channel id
    * @return Promise<DBSchema.RecordedSchema[]>
    */
    public async findAll(limit: number, offset: number = 0, option: findQuery = {}): Promise<DBSchema.RecordedSchema[]> {
        let query = `select * from ${ DBSchema.TableName.Recorded } `;

        query += this.buildFindQuery(option);

        query += ` order by id desc limit ${ offset }, ${ limit }`;

        let programs = await this.runQuery(query);
        return this.fixResult(<DBSchema.RecordedSchema[]>programs);
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
                query.push(`(name like ${ baseStr } or description like ${ baseStr })`);
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
    * 件数取得
    * @return Promise<number>
    */
    public getTotal(option: findQuery = {}): Promise<number> {
        return this.total(DBSchema.TableName.Recorded, this.buildFindQuery(option));
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
    private getTag<T>(item: string): Promise<T> {
        return this.runQuery(`select count(*) as cnt, ${ item } from ${ DBSchema.TableName.Recorded } group by ${ item } order by ${ item } asc`);
    }
}

export { findQuery, RecordedDBInterface, RecordedDB };

