import * as apid from '../../../../node_modules/mirakurun/api';
import DateUtil from '../../Util/DateUtil';
import StrUtil from '../../Util/StrUtil';
import { SearchInterface } from '../Operator/RuleInterface';
import * as DBSchema from './DBSchema';
import DBTableBase from './DBTableBase';

/**
 * 放送波索引
 */
interface ChannelTypeHash {
    [key: number]: { // NetworkId
        [key: number]: { // ServiceId
            type: apid.ChannelType;
            channel: string;
        };
    };
}

/**
 * 放送波オプション
 */
interface Broadcast {
    GR: boolean;
    BS: boolean;
    CS: boolean;
    SKY: boolean;
}

/**
 * keyword option
 */
interface KeywordOption {
    cs: boolean;
    regExp: boolean;
    title: boolean;
    description: boolean;
    extended: boolean;
}

/**
 * keyword query
 */
interface KeywordQuery {
    title: string[];
    description: string[];
    extended: string[];
}

interface ProgramsDBInterface extends DBTableBase {
    create(): Promise<void>;
    drop(): Promise<void>;
    insert(channelTypes: ChannelTypeHash, programs: apid.Program[], isDelete?: boolean): Promise<void>;
    delete(programId: number): Promise<void>;
    deleteOldPrograms(): Promise<void>;
    findSchedule(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, type?: apid.ChannelType): Promise<DBSchema.ScheduleProgramItem[]>;
    findScheduleId(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, channelId: apid.ServiceItemId): Promise<DBSchema.ScheduleProgramItem[]>;
    findBroadcasting(addition?: apid.UnixtimeMS): Promise<DBSchema.ScheduleProgramItem[]>;
    findBroadcastingChanel(channelId: apid.ServiceItemId, addition?: apid.UnixtimeMS): Promise<DBSchema.ScheduleProgramItem[]>;
    findId(id: number, isNow?: boolean): Promise<DBSchema.ProgramSchema | null>;
    findIdMiniColumn(id: number): Promise<DBSchema.ScheduleProgramItem | null>;
    findRule(option: SearchInterface, isMinColumn?: boolean, limit?: number | null): Promise<DBSchema.ProgramSchemaWithOverlap[]>;
}

/**
 * ProgramsDB
 */
abstract class ProgramsDB extends DBTableBase implements ProgramsDBInterface {
    /**
     * get table name
     * @return string
     */
    protected getTableName(): string {
        return DBSchema.TableName.Programs;
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
        return this.operator.runQuery(`drop table if exists ${ DBSchema.TableName.Programs }`);
    }

    /**
     * insert 時の config を取得
     */
    public getInsertConfig(): { insertMax: number; insertWait: number } {
        const config = this.config.getConfig();

        return {
            insertMax: config.programInsertMax || 100,
            insertWait: config.programInsertWait || 0,
        };
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

        // insert query str
        const queryStr = `${ isReplace ? 'replace' : 'insert' } into ${ DBSchema.TableName.Programs } (`
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
                + 'shortName,'
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

        const datas: any[] = [];
        let values: any[] = [];
        let cnt = 0;
        programs.forEach((program, index) => {
            if (typeof program.name === 'undefined') { return; }

            const date = DateUtil.getJaDate(new Date(program.startAt));
            let genre1: number | null = null;
            let genre2: number | null = null;
            if (typeof program.genres === 'undefined') {
                genre1 = null;
                genre2 = null;
            } else {
                for (let i = 0; i < program.genres.length; i++) {
                    if (program.genres[0].lv1 < 0xE || i + 1 === program.genres.length) {
                        genre1 = program.genres[i].lv1;
                        genre2 = typeof program.genres[i].lv2 === 'undefined' ? null : program.genres[i].lv2;
                        break;
                    }
                }
            }

            // サービスが存在しない
            if (typeof channelTypes[program.networkId] ===  'undefined' || typeof channelTypes[program.networkId][program.serviceId] === 'undefined') {
                return;
            }

            const channelType = channelTypes[program.networkId][program.serviceId].type;
            const channel = channelTypes[program.networkId][program.serviceId].channel;

            const name = StrUtil.toHalf(program.name);
            const tmp = [
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
                name,
                StrUtil.deleteBrackets(name),
                typeof program.description === 'undefined' || program.description === '' ? null : StrUtil.toHalf(program.description),
                this.createExtendedStr(program.extended),
                genre1,
                genre2,
                channelType,
                channel,
            ];

            if (typeof program.video !== 'undefined') {
                tmp.push(program.video.type);
                tmp.push(program.video.resolution);
                tmp.push(program.video.streamContent);
                tmp.push(program.video.componentType);
            } else {
                for (let i = 0; i < 4; i++) { tmp.push(null); }
            }

            if (typeof program.audio !== 'undefined') {
                tmp.push(program.audio.samplingRate);
                tmp.push(program.audio.componentType);
            } else {
                for (let i = 0; i < 2; i++) { tmp.push(null); }
            }

            Array.prototype.push.apply(values, tmp);

            cnt += 1;

            // values にデータが溜まったら datas に吐き出す
            if (cnt === config.insertMax || index === programs.length - 1) {
                let str = queryStr;
                let valueCnt = 0;
                for (let i = 0; i < cnt; i++) {
                    str += '( '
                    + this.operator.createValueStr(valueCnt + 1, valueCnt + 25)
                    + ' ),';
                    valueCnt += 25;
                }
                str = str.substr(0, str.length - 1);

                if (!isReplace) {
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
                        + 'shortName = excluded.shortName, '
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
                        + 'audioComponentType = excluded.audioComponentType ';
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
    private createExtendedStr(extended: { [description: string]: string } | undefined): string | null {
        if (typeof extended === 'undefined') { return null; }

        let str = '';
        for (const key in extended) {
            if (key.slice(0, 1) === '◇') {
                str += `\n${key}\n${ extended[key] }`;
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
    public async findSchedule(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, type?: apid.ChannelType): Promise<DBSchema.ScheduleProgramItem[]> {
        let query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } where `;

        if (typeof type !== 'undefined') {
            query += `channelType = '${ type }' and `;
        }

        query += `endAt >= ${ startAt } and ${ endAt } > startAt `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]> this.fixResults(<DBSchema.ScheduleProgramItem[]> await this.operator.runQuery(query));
    }

    /**
     * @param programs: ScheduleProgramItem[] | ProgramSchema[] | ProgramSchemaWithOverlap[]
     * @return ScheduleProgramItem[] | ProgramSchema[] | ProgramSchemaWithOverlap[]
     */
    protected fixResults(programs: DBSchema.ScheduleProgramItem[] | DBSchema.ProgramSchema[] | DBSchema.ProgramSchemaWithOverlap[]): DBSchema.ScheduleProgramItem[] | DBSchema.ProgramSchema[] | DBSchema.ProgramSchemaWithOverlap[] {
        return programs;
    }

    /**
     * チャンネル別番組表データを取得
     * @param startAt: 開始時刻
     * @param endAt: 終了時刻
     * @param channelId: channel id
     * @return Promise<DBSchema.ScheduleProgramItem[]>
     */
    public async findScheduleId(startAt: apid.UnixtimeMS, endAt: apid.UnixtimeMS, channelId: apid.ServiceItemId): Promise<DBSchema.ScheduleProgramItem[]> {
        const query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } `
            + `where channelId = ${ channelId } `
            + `and endAt >= ${ startAt } and ${ endAt } > startAt `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]> this.fixResults(<DBSchema.ScheduleProgramItem[]> await this.operator.runQuery(query));
    }

    /**
     * 放映中の番組データを取得
     * @param addition 加算時間(ms)
     * @return Promise<DBSchema.ScheduleProgramItem[]>
     */
    public async findBroadcasting(addition: apid.UnixtimeMS = 0): Promise<DBSchema.ScheduleProgramItem[]> {
        let now = new Date().getTime();
        now += addition;

        const query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } `
            + `where endAt >= ${ now } and ${ now } > startAt `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]> this.fixResults(<DBSchema.ScheduleProgramItem[]> await this.operator.runQuery(query));
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

        const query = `select ${ this.getMinColumns() } `
            + `from ${ DBSchema.TableName.Programs } `
            + `where endAt > ${ now } and ${ now } >= startAt and channelId = ${ channelId } `
            + 'order by startAt';

        return <DBSchema.ScheduleProgramItem[]> this.fixResults(<DBSchema.ScheduleProgramItem[]> await this.operator.runQuery(query));
    }

    /**
     * id 検索
     * @param id: id
     * @param isNow: boolean 現在時刻以降を探す場合 ture, すべて探す場合は false
     * @return Promise<DBSchema.ProgramSchema | null>
     */
    public async findId(id: number, isNow: boolean = false): Promise<DBSchema.ProgramSchema | null> {
        const option = isNow ? `and endAt > ${ new Date().getTime() }` : '';

        return this.operator.getFirst(<DBSchema.ProgramSchema[]> this.fixResults(<DBSchema.ProgramSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Programs } where id = ${ id } ${ option }`)));
    }

    /**
     * id 検索 (mini column)
     * @param id: id
     * @return Promise<DBSchema.ScheduleProgramItem | null>
     */
    public async findIdMiniColumn(id: number): Promise<DBSchema.ScheduleProgramItem | null> {
        return this.operator.getFirst(<DBSchema.ScheduleProgramItem[]> this.fixResults(<DBSchema.ScheduleProgramItem[]> await this.operator.runQuery(`select ${ this.getMinColumns() } from ${ DBSchema.TableName.Programs } where id = ${ id }`)));
    }

    /**
     * ルール検索
     * @param option: SearchInterface
     * @return Promise<DBSchema.ProgramSchemaWithOverlap[]>
     */
    public async findRule(option: SearchInterface, isMinColumn: boolean = false, limit: number | null = null): Promise<DBSchema.ProgramSchemaWithOverlap[]> {
        let column = isMinColumn ? this.getMinColumns() : this.getAllColumns();

        // 重複回避
        if (!!option.avoidDuplicate && typeof option.periodToAvoidDuplicate !== 'undefined') {
            const period = option.periodToAvoidDuplicate * 24 * 60 * 60 * 1000;
            const now = new Date().getTime();
            column += ', case when id in '
                + '('
                + `select distinct P.id from ${ DBSchema.TableName.Programs } as P, ${ DBSchema.TableName.RecordedHistory } as R`
                + ' where P.shortName = R.name'
                + ` and R.endAt <= ${ now }`;
            if (option.periodToAvoidDuplicate > 0) {
                column += ` and R.endAt >= ${ now - period } and R.endAt <= ${ now }`
                    + ` and P.endAt <= (R.endAt + ${ period })`;
            }

            column += `) then ${ this.getOverlapColumn() } end`
                + ' as overlap';
        }

        let query = `select ${ column } from ${ DBSchema.TableName.Programs } ${ this.createQuery(option) } order by startAt asc`;
        if (limit !== null) { query += ` limit ${ limit }`; }

        return <DBSchema.ProgramSchema[]> this.fixResults(<DBSchema.ProgramSchema[]> await this.runFindRule(query, Boolean(option.keyCS)));
    }

    /**
     * overlap のカラム設定
     * @return string
     */
    protected getOverlapColumn(): string {
        return 'true else false';
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
     * create regexp str
     * @param cs: boolean 大小文字区別
     * @return string
     */
    public createRegexpStr(cs: boolean): string {
        return cs ? 'regexp binary' : 'regexp';
    }

    /**
     * 大文字小文字判定が有効か
     * @return boolean
     */
    public isEnableCS(): boolean {
        return true;
    }

    /**
     * create like str
     * @param cs: boolean 大小文字区別
     */
    public createLikeStr(cs: boolean): string {
        return cs ? 'like binary' : 'like';
    }

    /**
     * ルール検索用の where 以下の条件を生成する
     * @param option: SearchInterface
     * @return string
     */
    private createQuery(option: SearchInterface): string {
        const query: string[] = [];

        // week
        if (typeof option.week !== 'undefined' && option.week < 0x7f) {
            query.push(this.createWeek(option.week));
        }

        // isFree
        if (typeof option.isFree !== 'undefined' && option.isFree) {
            query.push(this.createIsFree(option.isFree));
        }

        // durationMin
        if (typeof option.durationMin !== 'undefined') {
            query.push(this.createDurationMin(option.durationMin));
        }

        // durationMax
        if (typeof option.durationMax !== 'undefined') {
            query.push(this.createDurationMax(option.durationMax));
        }

        // time
        if (typeof option.startTime !== 'undefined' && typeof option.timeRange !== 'undefined') {
            query.push(this.createTime(option.startTime, option.timeRange));
        }

        // genre
        if (typeof option.genrelv1 !== 'undefined') {
            query.push(typeof option.genrelv2 === 'undefined' ? this.createShortGenre(option.genrelv1) : this.createGenre(option.genrelv1, option.genrelv2));
        }

        // station
        if (typeof option.station !== 'undefined') {
            query.push(this.createStation(option.station));
        }

        // broadcast
        if (!(option.GR && option.BS && option.CS && option.SKY) && (option.GR || option.BS || option.CS || option.SKY)) {
            query.push(this.createBroadcast({
                GR: Boolean(option.GR),
                BS: Boolean(option.BS),
                CS: Boolean(option.CS),
                SKY: Boolean(option.SKY),
            }));
        }

        // keyword
        if (typeof option.keyword !== 'undefined' || typeof option.ignoreKeyword !== 'undefined') {
            const keyOption: KeywordOption = {
                cs: Boolean(option.keyCS),
                regExp: Boolean(option.keyRegExp),
                title: Boolean(option.title),
                description: Boolean(option.description),
                extended: Boolean(option.extended),
            };

            if (!this.isEnableRegExp()) { keyOption.regExp = false; }
            if (!this.isEnableCS()) { keyOption.cs = false; }

            const title: string[] = [];
            const description: string[] = [];
            const extended: string[] = [];

            // keyword
            if (typeof option.keyword !== 'undefined') {
                const result = this.createKeyword(option.keyword, keyOption);
                Array.prototype.push.apply(title, result.title);
                Array.prototype.push.apply(description, result.description);
                Array.prototype.push.apply(extended, result.extended);
            }

            // ignoreKeyword
            if (typeof option.ignoreKeyword !== 'undefined') {
                const result = this.createIgnoreKeyword(option.ignoreKeyword, keyOption);
                Array.prototype.push.apply(title, result.title);
                Array.prototype.push.apply(description, result.description);
                Array.prototype.push.apply(extended, result.extended);
            }

            const or: string[] = [];
            if (title.length > 0) { or.push(`(${ this.createAndQuery(title) })`); }
            if (description.length > 0) { or.push(`(${ this.createAndQuery(description) })`); }
            if (extended.length > 0) { or.push(`(${ this.createAndQuery(extended) })`); }
            query.push(`(${ this.createOrQuery(or) })`);
        }

        // join query
        let queryStr = `where endAt > ${ new Date().getTime() }`;
        if (query.length > 0) {
           queryStr = queryStr + ' and ' + this.createAndQuery(query);
        }

        return queryStr;
    }

    /**
     * create week option
     * @param week: number
     * @return string
     */
    protected createWeek(week: number): string {
        let weekStr = '';
        if ((week & 0x01) !== 0) { weekStr += '0,'; } // 日
        if ((week & 0x02) !== 0) { weekStr += '1,'; } // 月
        if ((week & 0x04) !== 0) { weekStr += '2,'; } // 火
        if ((week & 0x08) !== 0) { weekStr += '3,'; } // 水
        if ((week & 0x10) !== 0) { weekStr += '4,'; } // 木
        if ((week & 0x20) !== 0) { weekStr += '5,'; } // 金
        if ((week & 0x40) !== 0) { weekStr += '6,'; } // 土

        if (weekStr.length !== 0) {
            weekStr = weekStr.slice(0, -1);
        }

        return `week in (${ weekStr })`;
    }

    /**
     * create isFree option
     * @param isFree: boolean
     * @return string
     */
    protected createIsFree(isFree: boolean): string {
        return `isFree = ${ this.operator.convertBoolean(isFree) }`;
    }

    /**
     * create duration min option
     * @param durationMin: number
     * @return string
     */
    protected createDurationMin(durationMin: number): string {
        return `duration >= ${ durationMin * 1000 }`;
    }

    /**
     * create duration max option
     * @param durationMax: number
     * @return string
     */
    protected createDurationMax(durationMax: number): string {
        return `duration <= ${ durationMax * 1000 }`;
    }

    /**
     * create time option
     * @param startTime: number
     * @param timeRange: number
     * @return string
     */
    protected createTime(startTime: number, timeRange: number): string {
        const endTime = startTime + timeRange - 1;

        let timeStr = '';
        if (startTime === endTime) {
            timeStr = `startHour = ${ startTime }`;
        } else {
            let times = '';
            for (let i = startTime; i <= endTime; i++) { times += `${ i % 24 },`; }
            times = times.slice(0, -1);
            timeStr = `startHour in (${ times })`;
        }

        return timeStr;
    }

    /**
     * create genre option
     * @param genre1: number
     * @return string
     */
    protected createShortGenre(genre1: number): string {
        return `genre1 = ${ genre1 }`;
    }

    /**
     * create genre option
     * @param genre1: number
     * @param genre2?: number
     * @return string
     */
    protected createGenre(genre1: number, genre2: number): string {
        return `${ this.createShortGenre(genre1) } and genre2 = ${ genre2 }`;
    }

    /**
     * create station option
     * @param station: number
     * @return string
     */
    protected createStation(station: number): string {
        return `channelId = ${ station }`;
    }

    /**
     * create broadcast option
     * @param broadcasts: Broadcast
     * @return string
     */
    protected createBroadcast(broadcast: Broadcast): string {
        let broadcastStr = '';
        for (const key in broadcast) { if (broadcast[key]) { broadcastStr += `'${ key }',`; } }
        if (broadcastStr.length !== 0) {
            broadcastStr = broadcastStr.slice(0, -1);
        }

        return `channelType in (${ broadcastStr })`;
    }

    /**
     * create keyword
     * @param keyword: string
     * @param keyOption: KeywordOption
     * @return KeywordQuery
     */
    protected createKeyword(keyword: string, keyOption: KeywordOption): KeywordQuery {
        const nameQuery: string[] = [];
        const descriptionQuery: string[] = [];
        const extendedQuery: string[] = [];

        keyword = keyword.replace(/'/g, "\\'"); // ' を \' へ置換
        if (keyOption.regExp) {
            // 正規表現
            const baseStr = `'${ keyword }'`;
            if (keyOption.title) { nameQuery.push(`name ${ this.createRegexpStr(keyOption.cs) } ${ baseStr }`); }
            if (keyOption.description) { descriptionQuery.push(`description ${ this.createRegexpStr(keyOption.cs) } ${ baseStr }`); }
            if (keyOption.extended) { extendedQuery.push(`extended ${ this.createRegexpStr(keyOption.cs) } ${ baseStr }`); }
        } else {
            // あいまい検索
            StrUtil.toHalf(keyword).trim().split(' ').forEach((str) => {
                const baseStr = `'%${ str }%'`;
                if (keyOption.title) { nameQuery.push(`name ${ this.createLikeStr(keyOption.cs) } ${ baseStr }`); }
                if (keyOption.description) { descriptionQuery.push(`description ${ this.createLikeStr(keyOption.cs) } ${ baseStr }`); }
                if (keyOption.extended) { extendedQuery.push(`extended ${ this.createLikeStr(keyOption.cs) } ${ baseStr }`); }
            });
        }

        return {
            title: nameQuery,
            description: descriptionQuery,
            extended: extendedQuery,
        };
    }

    /**
     * create ignore keyword
     * @param ignoreKeyword: string
     * @param keyOption: KeywordOption
     * @return KeywordQuery
     */
    protected createIgnoreKeyword(ignoreKeyword: string, keyOption: KeywordOption): KeywordQuery {
        const nameQuery: string[] = [];
        const descriptionQuery: string[] = [];
        const extendedQuery: string[] = [];

        ignoreKeyword = ignoreKeyword.replace(/'/g, "\\'");
        StrUtil.toHalf(ignoreKeyword).trim().split(' ').forEach((str) => {
            // あいまい検索
            const baseStr = `'%${ str }%'`;
            if (keyOption.title) { nameQuery.push(`name not ${ this.createLikeStr(keyOption.cs) } ${ baseStr }`); }
            if (keyOption.description) { descriptionQuery.push(`description not ${ this.createLikeStr(keyOption.cs) } ${ baseStr }`); }
            if (keyOption.extended) { extendedQuery.push(`extended not ${ this.createLikeStr(keyOption.cs) } ${ baseStr }`); }
        });

        return {
            title: nameQuery,
            description: descriptionQuery,
            extended: extendedQuery,
        };
    }

    /**
     * and query 生成
     * @param query: string[]
     * @return string
     */
    protected createAndQuery(query: string[]): string {
        if (query.length === 0) { return ''; }

        let queryStr = '';
        query.forEach((str, index) => {
            if (index === query.length - 1) {
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
    protected createOrQuery(query: string[]): string {
        if (query.length === 0) { return ''; }

        let queryStr = '';
        query.forEach((str, index) => {
            if (index === query.length - 1) {
                queryStr += `${ str }`;
            } else {
                queryStr += `${ str } or `;
            }
        });

        return queryStr;
    }
}

export { ChannelTypeHash, Broadcast, KeywordOption, KeywordQuery, ProgramsDBInterface, ProgramsDB };

