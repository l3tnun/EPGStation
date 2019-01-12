import * as apid from '../../../../node_modules/mirakurun/api';
import DateUtil from '../../Util/DateUtil';
import RuleUtil from '../../Util/RuleUtil';
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
    private getInsertConfig(): { insertMax: number; insertWait: number; convertDBStr: string } {
        const config = this.config.getConfig();
        let insertMax = config.programInsertMax || 10;
        if (insertMax > 10) { insertMax = 10; }

        return {
            insertMax: insertMax,
            insertWait: config.programInsertWait || 0,
            convertDBStr: config.convertDBStr,
        };
    }

    /**
     * min columns
     * @return string
     */
    protected getMinColumns(): string {
        return 'id, channelId, startAt, endAt, isFree, name, description, extended, genre1, genre2, genre3, genre4, genre5, genre6, channelType, videoType, videoResolution, videoStreamContent, videoComponentType, audioSamplingRate, audioComponentType';
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
                + 'genre3,'
                + 'genre4,'
                + 'genre5,'
                + 'genre6,'
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
            let genre3: number | null = null;
            let genre4: number | null = null;
            let genre5: number | null = null;
            let genre6: number | null = null;
            if (typeof program.genres !== 'undefined') {
                // 最大3つのジャンルを格納する
                if (program.genres[0].lv1 < 0xE) {
                    genre1 = program.genres[0].lv1;
                    genre2 = typeof program.genres[0].lv2 === 'undefined' ? null : program.genres[0].lv2;
                }

                if (program.genres.length > 1 && program.genres[1].lv1 < 0xE) {
                    genre3 = program.genres[1].lv1;
                    genre4 = typeof program.genres[1].lv2 === 'undefined' ? null : program.genres[1].lv2;
                }

                if (program.genres.length > 2 && program.genres[2].lv1 < 0xE) {
                    genre5 = program.genres[2].lv1;
                    genre6 = typeof program.genres[2].lv2 === 'undefined' ? null : program.genres[2].lv2;
                }
            }

            // サービスが存在しない
            if (typeof channelTypes[program.networkId] ===  'undefined' || typeof channelTypes[program.networkId][program.serviceId] === 'undefined') {
                return;
            }

            const channelType = channelTypes[program.networkId][program.serviceId].type;
            const channel = channelTypes[program.networkId][program.serviceId].channel;

            const name = StrUtil.toDBStr(program.name, config.convertDBStr);
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
                typeof program.description === 'undefined' || program.description === '' ? null : StrUtil.toDBStr(program.description, config.convertDBStr),
                this.createExtendedStr(program.extended, config.convertDBStr),
                genre1,
                genre2,
                genre3,
                genre4,
                genre5,
                genre6,
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
                    + this.operator.createValueStr(valueCnt + 1, valueCnt + tmp.length)
                    + ' ),';
                    valueCnt += tmp.length;
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
                        + 'genre3 = excluded.genre3, '
                        + 'genre4 = excluded.genre4, '
                        + 'genre5 = excluded.genre5, '
                        + 'genre6 = excluded.genre6, '
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
    private createExtendedStr(extended: { [description: string]: string } | undefined, convertDBStr: string): string | null {
        if (typeof extended === 'undefined') { return null; }

        let str = '';
        for (const key in extended) {
            if (key.slice(0, 1) === '◇') {
                str += `\n${key}\n${ extended[key] }`;
            } else {
                str += `\n◇${key}\n${ extended[key] }`;
            }
        }

        const ret = StrUtil.toDBStr(str, convertDBStr).trim();

        return ret;
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
        const options = this.createQuery(option);

        // 重複回避
        if (!!option.avoidDuplicate && typeof option.periodToAvoidDuplicate !== 'undefined') {
            const period = option.periodToAvoidDuplicate * 24 * 60 * 60 * 1000;
            const now = new Date().getTime();
            column += ', case when id in '
                + '('
                + `select P.id from ${ DBSchema.TableName.Programs } as P, ${ DBSchema.TableName.RecordedHistory } as R`
                + ' where P.shortName = R.name'
                + ` and R.endAt <= ${ now }`;
            if (option.periodToAvoidDuplicate > 0) {
                column += ` and R.endAt >= ${ now - period } and R.endAt <= ${ now }`
                    + ` and P.endAt <= (R.endAt + ${ period })`;
            }

            column += `) then ${ this.getOverlapColumn() } end`
                + ' as overlap';
        }

        let query = `select ${ column } from ${ DBSchema.TableName.Programs } ${ options.query } order by startAt asc`;
        if (limit !== null) { query += ` limit ${ limit }`; }

        return <DBSchema.ProgramSchema[]> this.fixResults(<DBSchema.ProgramSchema[]> await this.runFindRule(query, options.values, Boolean(option.keyCS)));
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
     * @param values: any[]
     * @param cs: boolean
     * @return Promise<DBSchema.ProgramSchema[]>
     */
    public runFindRule(query: string, values: any[], _cs: boolean): Promise<DBSchema.ProgramSchema[]> {
        return this.operator.runQuery(query, values);
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
     * @return { query: string; values: any[] }
     */
    private createQuery(option: SearchInterface): { query: string; values: any[] } {
        const query: string[] = [];
        const values: any[] = [];

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
            // keyword
            if (typeof option.keyword !== 'undefined') {
                const result = this.createKeyword(option.keyword, this.createKeywordOption(option, false), values.length);
                query.push(result.query);
                Array.prototype.push.apply(values, result.values);
            }

            // ignoreKeyword
            if (typeof option.ignoreKeyword !== 'undefined') {
                const result = this.createKeyword(option.ignoreKeyword, this.createKeywordOption(option, true), values.length);
                query.push(`(not ${ result.query })`);
                Array.prototype.push.apply(values, result.values);
            }
        }

        // join query
        let queryStr = `where endAt > ${ new Date().getTime() }`;
        if (query.length > 0) {
           queryStr = queryStr + ' and ' + this.createAndQuery(query);
        }

        return { query: queryStr, values: values };
    }

    /**
     * create keywordOption
     * @param option: SearchInterface
     * @param isIgnoreKeyword: boolean
     * @return RuleUtil.KeywordOption
     */
    private createKeywordOption(option: SearchInterface, isIgnoreKeyword: boolean): RuleUtil.KeywordOption {
        const keyOption: RuleUtil.KeywordOption = {
            cs: Boolean(isIgnoreKeyword ? option.ignoreKeyCS : option.keyCS),
            regExp: Boolean(isIgnoreKeyword ? option.ignoreKeyRegExp : option.keyRegExp),
            title: Boolean(isIgnoreKeyword ? option.ignoreTitle : option.title),
            description: Boolean(isIgnoreKeyword ? option.ignoreDescription : option.description),
            extended: Boolean(isIgnoreKeyword ? option.ignoreExtended : option.extended),
        };

        if (!this.isEnableRegExp()) { keyOption.regExp = false; }
        if (!this.isEnableCS()) { keyOption.cs = false; }

        return keyOption;
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
        return `(genre1 = ${ genre1 } or genre3 = ${ genre1 } or genre5 = ${ genre1 })`;
    }

    /**
     * create genre option
     * @param genre1: number
     * @param genre2?: number
     * @return string
     */
    protected createGenre(genre1: number, genre2: number): string {
        return `((genre1 = ${ genre1 } and genre2 = ${ genre2 }) or (genre3 = ${ genre1 } and genre4 = ${ genre2 }) or (genre5 = ${ genre1 } and genre6 = ${ genre2 }))`;
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
     * @param keyOption: RuleUtil.KeywordOption
     * @param cnt: number values length
     * @return { query: string[]; values: any[] }
     */
    protected createKeyword(keyword: string, keyOption: RuleUtil.KeywordOption, cnt: number): { query: string; values: any[] } {
        const or: string[] = [];
        const values: any[] = [];

        if (keyOption.regExp) {
            // 正規表現
            const regexpStr = this.createRegexpStr(keyOption.cs);
            if (keyOption.title) {
                cnt += 1;
                or.push(`name ${ regexpStr } ${ this.operator.createValueStr(cnt, cnt) }`);
                values.push(keyword);
            }
            if (keyOption.description) {
                cnt += 1;
                or.push(`description is not null and description ${ regexpStr } ${ this.operator.createValueStr(cnt, cnt) }`);
                values.push(keyword);
            }
            if (keyOption.extended) {
                cnt += 1;
                or.push(`extended is not null and extended ${ regexpStr } ${ this.operator.createValueStr(cnt, cnt) }`);
                values.push(keyword);
            }
        } else {
            const titleQuery: string[] = [];
            const descriptionQuery: string[] = [];
            const extendedQuery: string[] = [];
            const titleValues: any[] = [];
            const descriptionValues: any[] = [];
            const extendedValues: any[] = [];

            // あいまい検索
            const likeStr = this.createLikeStr(keyOption.cs);
            // tslint:disable-next-line:no-irregular-whitespace
            const keywords = StrUtil.toDBStr(keyword, this.config.getConfig().convertDBStr).trim().split(/ |　/);
            const keywordCnt = keywords.length;

            keywords.forEach((str, i) => {
                i += 1;
                str = `%${ str }%`;

                if (keyOption.title) {
                    const position = cnt + i;
                    titleQuery.push(`name ${ likeStr } ${ this.operator.createValueStr(position, position) }`);
                    titleValues.push(str);
                }
                if (keyOption.description) {
                    const position = cnt + i + keywordCnt;
                    descriptionQuery.push(`description ${ likeStr } ${ this.operator.createValueStr(position, position) }`);
                    descriptionValues.push(str);
                }
                if (keyOption.extended) {
                    const position = cnt + i + keywordCnt * 2;
                    extendedQuery.push(`extended ${ likeStr } ${ this.operator.createValueStr(position, position) }`);
                    extendedValues.push(str);
                }
            });

            if (titleQuery.length > 0) {
                or.push(`(${ this.createAndQuery(titleQuery) })`);
                Array.prototype.push.apply(values, titleValues);
            }

            if (descriptionQuery.length > 0) {
                or.push(`(${ this.createAndQuery(descriptionQuery) })`);
                Array.prototype.push.apply(values, descriptionValues);
            }

            if (extendedQuery.length > 0) {
                or.push(`(${ this.createAndQuery(extendedQuery) })`);
                Array.prototype.push.apply(values, extendedValues);
            }
        }

        return {
            query: `(${ this.createOrQuery(or) })`,
            values: values,
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

export { ChannelTypeHash, Broadcast, ProgramsDBInterface, ProgramsDB };

