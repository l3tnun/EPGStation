import * as apid from '../../../../node_modules/mirakurun/api';
import DBBase from './DBBase';
import * as DBSchema from './DBSchema';
import { SearchInterface } from '../../Operator/RuleInterface';
import DateUtil from '../../Util/DateUtil';
import StrUtil from '../../Util/StrUtil';

/**
* 放送波索引
*/
interface ChannelTypeHash {
    [key: number]: { // NetworkId
        [key:number]: { //ServiceId
            type: apid.ChannelType;
            channel: string;
        }
    }
}

interface ProgramsDBInterface extends DBBase {
    create(): Promise<void>;
    insert(channelTypes: ChannelTypeHash, programs: apid.Program[], isDelete?: boolean): Promise<void>;
    delete(programId: number): Promise<void>;
    deleteOldPrograms(): Promise<void>;
    findSchedule(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, type: apid.ChannelType): Promise<DBSchema.ScheduleProgramItem[]>;
    findScheduleId(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, channelId: apid.ServiceItemId): Promise<DBSchema.ScheduleProgramItem[]>;
    findBroadcasting(addition?: apid.UnixtimeMS): Promise<DBSchema.ScheduleProgramItem[]>;
    findBroadcastingChanel(channelId: apid.ServiceItemId, addition?: apid.UnixtimeMS): Promise<DBSchema.ScheduleProgramItem[]>;
    findId(id: number, isNow?: boolean): Promise<DBSchema.ProgramSchema | null>;
    findRule(option: SearchInterface, isMinColumn?: boolean, limit?: number | null): Promise<DBSchema.ProgramSchema[]>;
}

/**
* ProgramsDB
*/
abstract class ProgramsDB extends DBBase implements ProgramsDBInterface {
    /**
    * create table
    * @return Promise<void>
    */
    abstract create(): Promise<void>;

    /**
    * insert 時の config を取得
    */
    public getInsertConfig(): { insertMax: number, insertWait: number } {
        const config = this.config.getConfig();
        return {
            insertMax: config.programInsertMax || 100,
            insertWait: config.programInsertWait || 0,
        }
    }

    /**
    * min columns
    * @return string
    */
    protected getMinColumns(): string {
        return 'id, channelId, startAt, endAt, isFree, name, description, extended, genre1, genre2, channelType, videoType, videoResolution, videoStreamContent, videoComponentType, audioSamplingRate, audioComponentType';
    }

    /**
    * Programs 挿入
    * @param channelTypes: ChannelTypeHash 放送波索引
    * @param programs: Programs
    * @param isDelete: 挿入時に古いデータを削除するか true: 削除, false: 削除しない
    * @return Promise<void>
    */
    public insert(channelTypes: ChannelTypeHash, programs: apid.Program[], isDelete: boolean = true): Promise<void> {
        const isReplace = this.operator.getUpsertType() === 'replace';
        const config = this.getInsertConfig();

        //insert query str
        let queryStr = `${ isReplace ? 'replace' : 'insert' } into ${ DBSchema.TableName.Programs } (`
                + 'id,'
                + 'channelId,'
                + 'eventId,'
                + 'serviceId,'
                + 'networkId,'
                + 'startAt,'
                + 'endAt,'
                + 'startHour,'
                + 'week,'
                + 'duration,'
                + 'isFree,'
                + 'name,'
                + 'description,'
                + 'extended,'
                + 'genre1,'
                + 'genre2,'
                + 'channelType,'
                + 'channel,'
                + 'videoType,'
                + 'videoResolution,'
                + 'videoStreamContent,'
                + 'videoComponentType,'
                + 'audioSamplingRate,'
                + 'audioComponentType'
        + ') VALUES ';

        let datas: any[] = [];
        let values: any[] = [];
        let cnt = 0;
        programs.forEach((program, index) => {
            if(typeof program.name === 'undefined') { return; }

            let date = DateUtil.getJaDate(new Date(program.startAt));
            let genre1: number | null = null;
            let genre2: number | null = null;
            if(typeof program.genres === 'undefined') {
                genre1 = null;
                genre2 = null;
            } else {
                for(let i = 0; i < program.genres.length; i++) {
                    if(program.genres[0].lv1 < 0xE || i + 1 === program.genres.length) {
                        genre1 = program.genres[i].lv1;
                        genre2 = typeof program.genres[i].lv2 === 'undefined' ? null : program.genres[i].lv2;
                        break;
                    }
                }
            }

            // サービスが存在しない
            if(typeof channelTypes[program.networkId] ===  'undefined' || typeof channelTypes[program.networkId][program.serviceId] === 'undefined') {
                return;
            }

            let channelType = channelTypes[program.networkId][program.serviceId].type;
            let channel = channelTypes[program.networkId][program.serviceId].channel;

            let tmp = [
                program.id,
                parseInt(program.networkId + (program.serviceId / 100000).toFixed(5).slice(2), 10),
                program.eventId,
                program.serviceId,
                program.networkId,
                program.startAt,
                program.startAt + program.duration,
                date.getHours(),
                date.getDay(),
                program.duration,
                program.isFree,
                StrUtil.toHalf(program.name),
                typeof program.description === 'undefined' || program.description === "" ? null : StrUtil.toHalf(program.description),
                this.createExtendedStr(program.extended),
                genre1,
                genre2,
                channelType,
                channel,
            ];

            if(typeof program.video !== 'undefined') {
                tmp.push(program.video.type);
                tmp.push(program.video.resolution);
                tmp.push(program.video.streamContent);
                tmp.push(program.video.componentType);
            } else {
                for(let i = 0; i < 4; i++) { tmp.push(null); }
            }

            if(typeof program.audio !== 'undefined') {
                tmp.push(program.audio.samplingRate);
                tmp.push(program.audio.componentType);
            } else {
                for(let i = 0; i < 2; i++) { tmp.push(null); }
            }

            Array.prototype.push.apply(values, tmp);

            cnt += 1;

            // values にデータが溜まったら datas に吐き出す
            if(cnt === config.insertMax || index == programs.length - 1) {
                let str = queryStr;
                let valueCnt = 0;
                for(let i = 0; i < cnt; i++) {
                    str += '( '
                    + this.operator.createValueStr(valueCnt + 1, valueCnt + 24)
                    + ' ),'
                    valueCnt += 24;
                }
                str = str.substr(0, str.length - 1);

                if(!isReplace) {
                    str += ' on conflict (id) do update set '
                        + 'channelId = excluded.channelId, '
                        + 'eventId = excluded.eventId, '
                        + 'serviceId = excluded.serviceId, '
                        + 'networkId = excluded.networkId, '
                        + 'startAt = excluded.startAt, '
                        + 'endAt = excluded.endAt, '
                        + 'startHour = excluded.startHour, '
                        + 'week = excluded.week, '
                        + 'duration = excluded.duration, '
                        + 'isFree = excluded.isFree, '
                        + 'name = excluded.name, '
                        + 'description = excluded.description, '
                        + 'extended = excluded.extended, '
                        + 'genre1 = excluded.genre1, '
                        + 'genre2 = excluded.genre2, '
                        + 'channelType = excluded.channelType, '
                        + 'channel = excluded.channel, '
                        + 'videoType = excluded.videoType, '
                        + 'videoResolution = excluded.videoResolution, '
                        + 'videoStreamContent = excluded.videoStreamContent, '
                        + 'videoComponentType = excluded.videoComponentType, '
                        + 'audioSamplingRate = excluded.audioSamplingRate, '
                        + 'audioComponentType = excluded.audioComponentType '
                }

                datas.push({ query: str, values: values });
                values = [];
                cnt = 0;
            }
        });

        return this.operator.manyInsert(DBSchema.TableName.Programs, datas, isDelete, config.insertWait);
    }

    /**
    * extended を結合
    * @param extended extended
    * @return string
    */
    private createExtendedStr(extended: { [description: string]: string; } | undefined): string | null {
        if(typeof extended == 'undefined') { return null; }

        let str = '';
        for(let key in extended) {
            if(key.slice(0, 1) === '◇') {
                str += `\n${key}\n${ extended[key] }`
            } else {
                str += `\n◇${key}\n${ extended[key] }`;
            }
        }

        return StrUtil.toHalf(str).trim();
    }

    /**
    * program を削除
    * @param programId: program id
    * @return Promise<void>
    */
    public delete(programId: number): Promise<void> {
        return this.operator.runQuery(`delete from ${ DBSchema.TableName.Programs } where id = ${ programId }`);
    }

    /**
    * 1 時間以上経過した program を削除
    */
    public deleteOldPrograms(): Promise<void> {
        return this.operator.runQuery(`delete from ${ DBSchema.TableName.Programs } where endAt < ${ new Date().getTime()  - (1 * 60 * 60 * 1000) }`);
    }

    /**
    * 番組表データを取得
    * @param startAt: 開始時刻
    * @param endAt: 終了時刻
    * @param type: 放送波
    * @return Promise<DBSchema.ScheduleProgramItem[]>
    */
    public async findSchedule(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, type: apid.ChannelType): Promise<DBSchema.ScheduleProgramItem[]> {
        let query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } `
            + `where channelType = '${ type }' `
            + `and endAt >= ${ startAt } and ${ endAt } > startAt `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]>this.fixResult(<DBSchema.ScheduleProgramItem[]>await this.operator.runQuery(query));
    }

    /**
    * @param programs: ScheduleProgramItem[] | ProgramSchema[]
    * @return ScheduleProgramItem[] | ProgramSchema[]
    */
    protected fixResult(programs: DBSchema.ScheduleProgramItem[] | DBSchema.ProgramSchema[]): DBSchema.ScheduleProgramItem[] | DBSchema.ProgramSchema[] {
        return (<any>programs).map((program: any) => {
            program.isFree = Boolean(program.isFree);
            return program;
        });
    }

    /**
    * チャンネル別番組表データを取得
    * @param startAt: 開始時刻
    * @param endAt: 終了時刻
    * @param channelId: channel id
    * @return Promise<DBSchema.ScheduleProgramItem[]>
    */
    public async findScheduleId(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, channelId: apid.ServiceItemId): Promise<DBSchema.ScheduleProgramItem[]> {
        let query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } `
            + `where channelId = ${ channelId } `
            + `and endAt >= ${ startAt } and ${ endAt } > startAt `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]>this.fixResult(<DBSchema.ScheduleProgramItem[]>await this.operator.runQuery(query));
    }

    /**
    * 放映中の番組データを取得
    * @param addition 加算時間(ms)
    * @return Promise<DBSchema.ScheduleProgramItem[]>
    */
    public async findBroadcasting(addition: apid.UnixtimeMS = 0): Promise<DBSchema.ScheduleProgramItem[]> {
        let now = new Date().getTime();
        now += addition;

        let query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } `
            + `where endAt >= ${ now } and ${ now } > startAt `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]>this.fixResult(<DBSchema.ScheduleProgramItem[]>await this.operator.runQuery(query));
    }

    /**
    * 放映中の番組データを channelId を指定して取得
    * @param channelId: channel id
    * @param addition 加算時間(ms)
    * @return  Promise<DBSchema.ScheduleProgramItem[]>
    */
    public async findBroadcastingChanel(channelId: apid.ServiceItemId, addition: apid.UnixtimeMS = 0): Promise<DBSchema.ScheduleProgramItem[]> {
        let now = new Date().getTime();
        now += addition;

        let query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } `
            + `where endAt > ${ now } and ${ now } >= startAt and channelId = ${ channelId } `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]>this.fixResult(<DBSchema.ScheduleProgramItem[]>await this.operator.runQuery(query));
    }

    /**
    * id 検索
    * @param id: id
    * @param isNow: boolean 現在時刻以降を探す場合 ture, すべて探す場合は false
    * @return Promise<DBSchema.ProgramSchema | null>
    */
    public async findId(id: number, isNow: boolean = false): Promise<DBSchema.ProgramSchema | null> {
        let option = isNow ? `and endAt > ${ new Date().getTime() }` : '';
        return this.operator.getFirst(<DBSchema.ProgramSchema[]>this.fixResult(<DBSchema.ProgramSchema[]>await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Programs } where id = ${ id } ${ option }`)));
    }

    /**
    * ルール検索
    * @param option: SearchInterface
    * @return Promise<DBSchema.ProgramSchema[]>
    */
    public async findRule(option: SearchInterface, isMinColumn: boolean = false, limit: number | null = null): Promise<DBSchema.ProgramSchema[]> {
        const column = isMinColumn ? this.getMinColumns() : this.getAllColumns();
        let query = `select ${ column } from ${ DBSchema.TableName.Programs } ${ this.createQuery(option) } order by startAt asc`;
        if(limit != null) { query += ` limit ${ limit }`; }

        return <DBSchema.ProgramSchema[]>this.fixResult(<DBSchema.ProgramSchema[]>await this.runFindRule(query, Boolean(option.keyCS)));
    }

    /**
    * ルール検索実行部分
    * @param query: string
    * @param cs: boolean
    * @return Promise<DBSchema.ProgramSchema[]>
    */
    public runFindRule(query: string, _cs: boolean): Promise<DBSchema.ProgramSchema[]> {
        return this.operator.runQuery(query);
    }

    /**
    * regexp が有効か
    * @return boolean
    */
    public isEnableRegExp(): boolean {
        return true;
    }

    /**
    * 大文字小文字判定が有効か
    * @return boolean
    */
    public isEnableCS(): boolean {
        return true;
    }

    /**
    * ルール検索用の where 以下の条件を生成する
    * @param option: SearchInterface
    * @return string
    */
    private createQuery(option: SearchInterface): string {
        let query: string[] = [];

        //week
        if(typeof option.week !== 'undefined' && option.week < 0x7f) {
            let weekStr = '';
            if((option.week & 0x01) !== 0) { weekStr += `0,`; } //日
            if((option.week & 0x02) !== 0) { weekStr += `1,`; } //月
            if((option.week & 0x04) !== 0) { weekStr += `2,`; } //火
            if((option.week & 0x08) !== 0) { weekStr += `3,`; } //水
            if((option.week & 0x10) !== 0) { weekStr += `4,`; } //木
            if((option.week & 0x20) !== 0) { weekStr += `5,`; } //金
            if((option.week & 0x40) !== 0) { weekStr += `6,`; } //土

            if(weekStr.length !== 0) {
                weekStr = weekStr.slice(0, -1);
            }

            query.push(`week in (${ weekStr })`);            
        } 

        //isFree
        if(typeof option.isFree !== 'undefined' && option.isFree) {
            query.push(`isFree = ${ Number(option.isFree) }`);
        }

        //durationMin
        if(typeof option.durationMin !== 'undefined') {
            query.push(`duration >= ${ option.durationMin * 1000 }`);
        }

        //durationMax
        if(typeof option.durationMax !== 'undefined') {
            query.push(`duration <= ${ option.durationMax * 1000 }`);
        }

        //time
        if(typeof option.startTime !== 'undefined' && typeof option.timeRange !== 'undefined') {
            let start = option.startTime;
            let end = option.startTime + option.timeRange - 1;

            let timeStr = ''
            if(start === end) {
                timeStr = `startHour = ${ start }`;
            } else {
                let times = '';
                for(let i = start; i <= end; i++) { times += `${ i % 24 },`; }
                times = times.slice(0, -1);
                timeStr = `startHour in (${ times })`
            }
            query.push(timeStr);
        }

        //genre
        if(typeof option.genrelv1 !== 'undefined') {
            let genreStr = '';
            if(typeof option.genrelv2 === 'undefined') {
                genreStr = `genre1 = ${ option.genrelv1 }`;
            } else {
                genreStr = `genre1 = ${ option.genrelv1 } and genre2 = ${ option.genrelv2 }`;
            }

            query.push(genreStr);
        }

        //station
        if(typeof option.station !== 'undefined') {
            query.push(`channelId = ${ option.station }`);
        }

        //broadcast
        let broadcasts = {
            GR: Boolean(option.GR),
            BS: Boolean(option.BS),
            CS: Boolean(option.CS),
            SKY: Boolean(option.SKY),
        }
        if(!(broadcasts.GR && broadcasts.BS && broadcasts.CS && broadcasts.SKY)) {
            let broadcastStr = '';
            for(let key in broadcasts) { if(broadcasts[key]) { broadcastStr += `'${ key }',`; } }
            if(broadcastStr.length !== 0) {
                broadcastStr = broadcastStr.slice(0, -1);
            }

            if(broadcastStr.length !== 0) {
                query.push(`channelType in (${ broadcastStr })`);
            }
        }

        //keyword
        if(typeof option.keyword !== 'undefined' || typeof option.ignoreKeyword !== 'undefined') {
            let nameQuery: string[] = [];
            let descriptionQuery: string[] = [];
            let extendedQuery: string[] = [];

            //keywordOption 生成
            let keyOption = {
                cs: false,
                regExp: false,
                title: false,
                description: false,
                extended: false,
            };
            keyOption = {
                cs: Boolean(option.keyCS),
                regExp: Boolean(option.keyRegExp),
                title: Boolean(option.title),
                description: Boolean(option.description),
                extended: Boolean(option.extended),
            }

            if(!this.isEnableRegExp()) { keyOption.regExp = false; }
            if(!this.isEnableCS()) { keyOption.cs = false; }

            //keyword
            if(typeof option.keyword !== 'undefined') {
                let keyword = option.keyword.replace(/'/g, "\\'"); // ' を \' へ置換
                if(keyOption.regExp) {
                    let baseStr = `'${ keyword }'`;
                    if(keyOption.cs) { baseStr = 'binary ' + baseStr; }
                    if(keyOption.title) { nameQuery.push(`name regexp ${ baseStr }`); }
                    if(keyOption.description) { descriptionQuery.push(`description regexp ${ baseStr }`); }
                    if(keyOption.extended) { extendedQuery.push(`extended regexp ${ baseStr }`); }
                } else {
                    StrUtil.toHalf(keyword).trim().split(' ').forEach((str) => {
                        let baseStr = `'%${ str }%'`;
                        if(keyOption.cs) { baseStr = 'binary ' + baseStr; }
                        if(keyOption.title) { nameQuery.push(`name like ${ baseStr }`); }
                        if(keyOption.description) { descriptionQuery.push(`description like ${ baseStr }`); }
                        if(keyOption.extended) { extendedQuery.push(`extended like ${ baseStr }`); }
                    });
                }
            }

            //ignoreKeyword
            if(typeof option.ignoreKeyword !== 'undefined') {
                let ignoreKeyword = option.ignoreKeyword.replace(/'/g, "\\'");
                StrUtil.toHalf(ignoreKeyword).trim().split(' ').forEach((str) => {
                    let baseStr = `'%${ str }%'`;
                    if(keyOption.cs) { baseStr = 'binary ' + baseStr; }
                    if(keyOption.title) { nameQuery.push(`name not like ${ baseStr }`); }
                    if(keyOption.description) { descriptionQuery.push(`description not like ${ baseStr }`); }
                    if(keyOption.extended) { extendedQuery.push(`extended not like ${ baseStr }`); }
                });
            }

            let or: string[] = [];
            if(keyOption.title) { or.push(`(${ this.createAndQuery(nameQuery) })`); }
            if(keyOption.description) { or.push(`(${ this.createAndQuery(descriptionQuery) })`); }
            if(keyOption.extended) { or.push(`(${ this.createAndQuery(extendedQuery) })`); }
            query.push(`(${ this.createOrQuery(or) })`);
        }

        let queryStr = `where endAt > ${ new Date().getTime() }`;
        if(query.length > 0) {
           queryStr = queryStr + ' and ' + this.createAndQuery(query);
        }

        return queryStr;
    }

    /**
    * and query 生成
    * @param query: string[]
    * @return string
    */
    private createAndQuery(query: string[]): string {
        if(query.length == 0) { return ''; }

        let queryStr = '';
        query.forEach((str, index) => {
            if(index == query.length - 1) {
                queryStr += `${ str }`;
            } else {
                queryStr += `${ str } and `;
            }
        });

        return queryStr;
    }

    /**
    * or query 生成
    * @param query: string[]
    * @return string
    */
    private createOrQuery(query: string[]): string {
        if(query.length == 0) { return ''; }

        let queryStr = '';
        query.forEach((str, index) => {
            if(index == query.length - 1) {
                queryStr += `${ str }`;
            } else {
                queryStr += `${ str } or `;
            }
        });

        return queryStr;
    }
}

export { ChannelTypeHash, ProgramsDBInterface, ProgramsDB }
