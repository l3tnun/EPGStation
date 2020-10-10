import { inject, injectable } from 'inversify';
import { FindConditions, LessThan, LessThanOrEqual, MoreThanOrEqual, ObjectLiteral } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import * as apid from '../../../api';
import * as mapid from '../../../node_modules/mirakurun/api';
import Program from '../../db/entities/Program';
import DateUtil from '../../util/DateUtil';
import StrUtil from '../../util/StrUtil';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IPromiseRetry from '../IPromiseRetry';
import DBUtil from './DBUtil';
import IChannelTypeIndex from './IChannelTypeHash';
import IDBOperator from './IDBOperator';
import IProgramDB, {
    FindRuleOption,
    FindScheduleIdOption,
    FindScheduleOption,
    ProgramUpdateValues,
    ProgramWithOverlap,
} from './IProgramDB';

interface FindQuery {
    strs: string[];
    param: ObjectLiteral;
}

interface KeywordOption {
    cs: boolean;
    regexp: boolean;
    name: boolean;
    description: boolean;
    extended: boolean;
}

@injectable()
export default class ProgramDB implements IProgramDB {
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
     * 全件削除 & 更新
     * @param channelTypes: IChannelTypeHash
     * @param programs: mapid.Program[]
     */
    public async insert(channelTypes: IChannelTypeIndex, programs: mapid.Program[]): Promise<void> {
        const updateTime = new Date().getTime();
        const values: QueryDeepPartialEntity<Program>[] = [];

        for (const program of programs) {
            const value = this.createProgramValue(channelTypes, program, updateTime);

            if (value !== null) {
                values.push(value);
            }
        }

        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.delete(Program, {});

            // 挿入処理
            for (const value of values) {
                await queryRunner.manager.insert(Program, value);
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            console.error(err);
            hasError = true;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError) {
            throw new Error('InsertError');
        }
    }

    /**
     * mapid.Program から QueryDeepPartialEntity<Program> を生成する
     * @param channelTypes: IChannelTypeHash,
     * @param program: mapid.Program,
     * @param updateTime: number 更新時間
     * @return QueryDeepPartialEntity<Program> | null データが作成出来ないときは null を返す
     */
    private createProgramValue(
        channelTypes: IChannelTypeIndex,
        program: mapid.Program,
        updateTime: number,
    ): QueryDeepPartialEntity<Program> | null {
        if (typeof program.name === 'undefined') {
            return null;
        }

        // channelType, channel
        if (
            typeof channelTypes[program.networkId] === 'undefined' ||
            typeof channelTypes[program.networkId][program.serviceId] === 'undefined'
        ) {
            // サービスが存在しない
            return null;
        }
        const channelId = channelTypes[program.networkId][program.serviceId].id;
        const channelType = channelTypes[program.networkId][program.serviceId].type;
        const channel = channelTypes[program.networkId][program.serviceId].channel;

        // genre
        let genre1: number | null = null;
        let subGenre1: number | null = null;
        let genre2: number | null = null;
        let subGenre2: number | null = null;
        let genre3: number | null = null;
        let subGenre3: number | null = null;
        if (typeof program.genres !== 'undefined') {
            // 最大3つのジャンルを格納する
            if (program.genres[0].lv1 < 0xe) {
                genre1 = program.genres[0].lv1;
                subGenre1 = typeof program.genres[0].lv2 === 'undefined' ? null : program.genres[0].lv2;
            }

            if (program.genres.length > 1 && program.genres[1].lv1 < 0xe) {
                genre2 = program.genres[1].lv1;
                subGenre2 = typeof program.genres[1].lv2 === 'undefined' ? null : program.genres[1].lv2;
            }

            if (program.genres.length > 2 && program.genres[2].lv1 < 0xe) {
                genre3 = program.genres[2].lv1;
                subGenre3 = typeof program.genres[2].lv2 === 'undefined' ? null : program.genres[2].lv2;
            }
        }

        // 日本時間取得
        const jaDate = DateUtil.getJaDate(new Date(program.startAt));

        // 番組名
        const name = StrUtil.toDBStr(program.name);
        const halfWidthName = StrUtil.toHalf(name);

        const value: QueryDeepPartialEntity<Program> = {
            id: program.id,
            updateTime: updateTime,
            channelId: channelId,
            eventId: program.eventId,
            serviceId: program.serviceId,
            networkId: program.networkId,
            startAt: program.startAt,
            endAt: program.startAt + program.duration,
            startHour: jaDate.getHours(),
            week: jaDate.getDay(),
            duration: program.duration,
            isFree: program.isFree,
            name: name,
            halfWidthName: halfWidthName,
            shortName: StrUtil.deleteBrackets(halfWidthName),
            genre1: genre1,
            subGenre1: subGenre1,
            genre2: genre2,
            subGenre2: subGenre2,
            genre3: genre3,
            subGenre3: subGenre3,
            channelType: channelType,
            channel: channel,
        };

        // description
        if (typeof program.description === 'undefined' || program.description.length === 0) {
            value.description = null;
            value.halfWidthDescription = null;
        } else {
            const description = StrUtil.toDBStr(program.description);
            value.description = description;
            value.halfWidthDescription = StrUtil.toHalf(description);
        }

        // extended
        if (typeof program.extended === 'undefined') {
            value.extended = null;
            value.halfWidthExtended = null;
        } else {
            const extended = this.createExtendedStr(program.extended);
            value.extended = extended;
            value.halfWidthExtended = StrUtil.toHalf(extended);
        }

        // video
        if (typeof program.video !== 'undefined') {
            value.videoType = program.video.type;
            value.videoResolution = program.video.resolution;
            value.videoStreamContent = program.video.streamContent;
            value.videoComponentType = program.video.componentType;
        }

        // audio
        if (typeof program.audio !== 'undefined') {
            value.audioSamplingRate = program.audio.samplingRate;
            value.audioComponentType = program.audio.componentType;
        }

        return value;
    }

    /**
     * extended を結合
     * @param extended extended
     * @return string
     */
    private createExtendedStr(extended: { [description: string]: string }): string {
        let str = '';
        for (const key in extended) {
            if (key.slice(0, 1) === '◇') {
                str += `\n${key}\n${extended[key]}`;
            } else {
                str += `\n◇${key}\n${extended[key]}`;
            }
        }

        const ret = StrUtil.toDBStr(str).trim();

        return ret;
    }

    /**
     * event stream 用更新
     * @param channelTypes: IChannelTypeHash
     * @param values ProgramUpdateValues
     * @return Promise<void>
     */
    public async update(channelTypes: IChannelTypeIndex, values: ProgramUpdateValues): Promise<void> {
        const updateTime = new Date().getTime();
        const insertValues: QueryDeepPartialEntity<Program>[] = [];

        for (const program of values.insert) {
            const value = this.createProgramValue(channelTypes, program, updateTime);

            if (value !== null) {
                insertValues.push(value);
            }
        }

        for (const program of values.update) {
            const value = this.createProgramValue(channelTypes, program, updateTime);

            if (value !== null) {
                insertValues.push(value);
            }
        }

        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除処理
            for (const id of values.delete) {
                await queryRunner.manager.delete(Program, id).catch(err => {
                    this.log.system.error(`program delete error: ${id}`);
                    this.log.system.error(err);
                });
            }

            // 挿入処理
            for (const value of insertValues) {
                await queryRunner.manager.insert(Program, value).catch(async err => {
                    await queryRunner.manager.update(Program, value.id, value).catch(serr => {
                        this.log.system.error('program update error');
                        this.log.system.error(err);
                        this.log.system.error(serr);
                    });
                });
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            console.error(err);
            hasError = true;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError) {
            throw new Error('UpdateError');
        }
    }

    /**
     * 指定した時刻より古い番組情報を削除する
     * @param time: apid.UnixtimeMS
     * @return Promise<void>
     */
    public async deleteOld(time: apid.UnixtimeMS): Promise<void> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(Program);

        await this.promieRetry.run(() => {
            return repository.delete({
                endAt: LessThan(time),
            });
        });
    }

    /**
     * program id を指定して検索
     * @param programId: program id
     * @return Promise<Program | null>
     */
    public async findId(programId: apid.ProgramId): Promise<Program | null> {
        const connection = await this.op.getConnection();

        const repository = connection.getRepository(Program);
        const result = await this.promieRetry.run(() => {
            return repository.findOne({
                where: [{ id: programId }],
            });
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * ルールにマッチする番組を検索
     * @param searchOption: apid.RuleSearchOption
     * @param reserveOption?: apid.RuleReserveOption
     * @return Promise<Program[]>
     */
    public async findRule(option: FindRuleOption): Promise<ProgramWithOverlap[]> {
        const connection = await this.op.getConnection();

        const query: FindQuery = {
            strs: [],
            param: {},
        };

        // set query
        this.setKeywordQuery(option.searchOption, query);
        this.setChannelQuery(option.searchOption, query);
        this.setGenresQuery(option.searchOption, query);
        this.setTimesQuery(option.searchOption, query);
        this.setFreeQuery(option.searchOption, query);
        this.setDurationMinQuery(option.searchOption, query);
        this.setDurationMaxQuery(option.searchOption, query);
        this.setSearchPeriodsQuery(option.searchOption, query);

        // joint query str
        let str = '';
        for (let i = 0; i < query.strs.length; i++) {
            if (query.strs[i].length === 0) {
                continue;
            }
            str += `(${query.strs[i]})`;
            if (i < query.strs.length - 1) {
                str += ' and ';
            }
        }

        // ルールのオプションが何もない場合
        if (str.length === 0) {
            throw new Error('InvalidFindRuleOption');
        }

        let select = await connection.createQueryBuilder().select('program');
        if (typeof option.reserveOption !== 'undefined' && option.reserveOption.avoidDuplicate === true) {
            select = select.addSelect(
                this.createOverlapQueryStr(option.reserveOption.periodToAvoidDuplicate),
                'overlap',
            );
        }
        const queryBuilder = select
            .from(Program, 'program')
            .where(str, query.param)
            .andWhere(`${new Date().getTime()} <= program.endAt`)
            .orderBy('program.startAt', 'ASC')
            .limit(option.limit);

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getRawAndEntities();
        });

        // overlap を追加
        return result.entities.map((entity, i) => {
            // eslint-disable-next-line no-extra-boolean-cast
            (<any>entity).overlap = Boolean(!!result.raw[i].overlap);

            return <any>entity;
        });
    }

    /**
     * キーワードの検索オプションをセットする
     * @param searchOption: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setKeywordQuery(searchOption: apid.RuleSearchOption, query: FindQuery): void {
        if (typeof searchOption.keyword !== 'undefined') {
            this.setKeywordOption(
                searchOption.keyword,
                this.createKeywordOption(searchOption, false),
                'keyword',
                false,
                query,
            );
        }

        if (typeof searchOption.ignoreKeyword !== 'undefined') {
            this.setKeywordOption(
                searchOption.ignoreKeyword,
                this.createKeywordOption(searchOption, true),
                'ignoreKeyword',
                true,
                query,
            );
        }
    }

    /**
     * keyword を指定してquery に キーワード検索のオプションをセットする
     * @param keyword: string keyword
     * @param option: KeywordOption
     * @param valueBaseName: string query.param に格納するときのベース名
     * @param isIgnore: boolean 除外キーワードか
     * @param query: FindQuery
     */
    private setKeywordOption(
        keyword: string,
        option: KeywordOption,
        valueBaseName: string,
        isIgnore: boolean,
        query: FindQuery,
    ): void {
        const or: string[] = [];

        if (option.regexp === true) {
            // 正規表現
            const regexp = this.op.getRegexpStr(option.cs);
            const valueName = `${valueBaseName}Regexp`;
            query.param[valueName] = keyword;
            if (option.name === true) {
                or.push(`halfWidthName ${regexp} :${valueName}`);
            }
            if (option.description === true) {
                or.push(`halfWidthDescription ${regexp} :${valueName}`);
            }
            if (option.extended === true) {
                or.push(`halfWidthExtended ${regexp} :${valueName}`);
            }
        } else {
            // あいまい検索
            const keywords = StrUtil.toHalf(keyword).split(/ /);
            const like = this.op.getLikeStr(option.cs);

            const nameAnd: string[] = [];
            const descriptionAnd: string[] = [];
            const extendedAnd: string[] = [];
            keywords.forEach((str, i) => {
                str = `%${str}%`;

                if (option.name === true) {
                    const valueName = `${valueBaseName}Name${i}`;
                    nameAnd.push(`halfWidthName ${like} :${valueName}`);
                    query.param[valueName] = str;
                }
                if (option.description === true) {
                    const valueName = `${valueBaseName}Description${i}`;
                    descriptionAnd.push(`halfWidthDescription ${like} :${valueName}`);
                    query.param[valueName] = str;
                }
                if (option.extended === true) {
                    const valueName = `${valueBaseName}Extended${i}`;
                    extendedAnd.push(`halfWidthExtended ${like} :${valueName}`);
                    query.param[valueName] = str;
                }
            });

            if (nameAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(nameAnd)})`);
            }

            if (descriptionAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(descriptionAnd)})`);
            }

            if (extendedAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(extendedAnd)})`);
            }
        }

        const orStr = DBUtil.createOrQuery(or);
        query.strs.push(isIgnore ? `(not (${orStr}))` : orStr);
    }

    /**
     * keyword 検査のオプションを生成する
     * @param option: apid.RuleSearchOption
     * @param isIgnore: boolean
     * @return KeywordOption
     */
    private createKeywordOption(option: apid.RuleSearchOption, isIgnore: boolean): KeywordOption {
        const keyOption: KeywordOption = {
            cs: isIgnore ? !!option.ignoreKeyCS : !!option.keyCS,
            regexp: isIgnore ? !!option.ignoreKeyRegExp : !!option.keyRegExp,
            name: isIgnore ? !!option.ignoreName : !!option.name,
            description: isIgnore ? !!option.ignoreDescription : !!option.description,
            extended: isIgnore ? !!option.ignoreExtended : !!option.extended,
        };

        if (this.op.isEnableCS() === false) {
            keyOption.cs = false;
        }
        if (this.op.isEnabledRegexp() === false) {
            keyOption.regexp = false;
        }

        return keyOption;
    }

    /**
     * 放送局の検索オプションをセットする
     * @param searchOption: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setChannelQuery(searchOption: apid.RuleSearchOption, query: FindQuery): void {
        if (typeof searchOption.channelIds !== 'undefined') {
            // in で channelId を列挙
            this.createInQuery(query, 'channelId', searchOption.channelIds);
        } else {
            // in で channelType 列挙
            const channelTypes: string[] = [];
            if (!!searchOption.GR === true) {
                channelTypes.push('GR');
            }
            if (!!searchOption.BS === true) {
                channelTypes.push('BS');
            }
            if (!!searchOption.CS === true) {
                channelTypes.push('CS');
            }
            if (!!searchOption.SKY === true) {
                channelTypes.push('SKY');
            }
            this.createInQuery(query, 'channelType', channelTypes);
        }
    }

    /**
     * ジャンルの検索オプションをセットする
     * @param option: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setGenresQuery(option: apid.RuleSearchOption, query: FindQuery): void {
        if (typeof option.genres === 'undefined' || option.genres.length === 0) {
            return;
        }

        const strs: string[] = [];
        for (let i = 0; i < option.genres.length; i++) {
            const genreBaseName = `genre${i}`;
            const subGenreBaseName = `subgenre${i}`;
            query.param[genreBaseName] = option.genres[i].genre;

            if (typeof option.genres[i].subGenre === 'undefined') {
                strs.push(
                    '(' +
                        `genre1 = :${genreBaseName} or ` +
                        `genre2 = :${genreBaseName} or ` +
                        `genre3 = :${genreBaseName}` +
                        ')',
                );
            } else {
                strs.push(
                    '(' +
                        '(' +
                        `genre1 = :${genreBaseName} and ` +
                        `subGenre1 = :${subGenreBaseName}` +
                        ') or ' +
                        '(' +
                        `genre2 = :${genreBaseName} and ` +
                        `subGenre2 = :${subGenreBaseName}` +
                        ') or ' +
                        '(' +
                        `genre3 = :${genreBaseName} and ` +
                        `subGenre3 = :${subGenreBaseName}` +
                        ')' +
                        ')',
                );
                query.param[subGenreBaseName] = option.genres[i].subGenre;
            }
        }

        query.strs.push(DBUtil.createOrQuery(strs));
    }

    /**
     * 曜日と時刻レンジの検索オプションをセットする
     * @param searchOption: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setTimesQuery(option: apid.RuleSearchOption, query: FindQuery): void {
        if (typeof option.times === 'undefined' || option.times.length === 0) {
            return;
        }

        const strs: string[] = [];
        for (let i = 0; i < option.times.length; i++) {
            // 曜日
            const weeks: number[] = [];
            if ((option.times[i].week & 0x01) !== 0) {
                weeks.push(0); // 日
            }
            if ((option.times[i].week & 0x02) !== 0) {
                weeks.push(1); // 月
            }
            if ((option.times[i].week & 0x04) !== 0) {
                weeks.push(2); // 火
            }
            if ((option.times[i].week & 0x08) !== 0) {
                weeks.push(3); // 水
            }
            if ((option.times[i].week & 0x10) !== 0) {
                weeks.push(4); // 木
            }
            if ((option.times[i].week & 0x20) !== 0) {
                weeks.push(5); // 金
            }
            if ((option.times[i].week & 0x40) !== 0) {
                weeks.push(6); // 土
            }

            // 曜日情報がなければ無視
            if (weeks.length === 0) {
                continue;
            }

            // 曜日情報を query に追加
            const weekBaseColumnName = `week${i}`;
            let queryStr = `week in (:...${weekBaseColumnName})`;
            query.param[weekBaseColumnName] = weeks;

            // 時刻レンジを query に追加
            const start = option.times[i].start;
            const range = option.times[i].range;
            if (typeof start !== 'undefined' && typeof range !== 'undefined') {
                const startHourBaseColumnName = `time${i}`;
                const endTime = start + range - 1;
                if (start === endTime) {
                    queryStr += ` and startHour = :${startHourBaseColumnName}`;
                    query.param[startHourBaseColumnName] = start;
                } else {
                    const times: number[] = [];
                    for (let j = start; j <= endTime; j++) {
                        times.push(j % 24);
                    }
                    queryStr += `and startHour in (:...${startHourBaseColumnName})`;
                    query.param[startHourBaseColumnName] = times;
                }
            }

            strs.push(`(${queryStr})`);
        }

        query.strs.push(DBUtil.createOrQuery(strs));
    }

    /**
     * 無料放送の検索オプションをセットする
     * @param searchOption: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setFreeQuery(option: apid.RuleSearchOption, query: FindQuery): void {
        if (!!option.isFree === false) {
            return;
        }

        const column = 'isFree';
        query.strs.push(`isFree = :${column}`);
        query.param[column] = this.op.convertBoolean(true);
    }

    /**
     * 動画最小長の検索オプションをセットする
     * @param searchOption: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setDurationMinQuery(option: apid.RuleSearchOption, query: FindQuery): void {
        if (typeof option.durationMin === 'undefined') {
            return;
        }

        const column = 'durationMin';
        query.strs.push(`duration >= :${column}`);
        query.param[column] = option.durationMin * 1000;
    }

    /**
     * 動画大長の検索オプションをセットする
     * @param searchOption: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setDurationMaxQuery(option: apid.RuleSearchOption, query: FindQuery): void {
        if (typeof option.durationMax === 'undefined') {
            return;
        }

        const column = 'durationMax';
        query.strs.push(`duration <= :${column}`);
        query.param[column] = option.durationMax * 1000;
    }

    /**
     * 検索対象期間の検索オプションをセットする
     * @param searchOption: apid.RuleSearchOption
     * @param query: FindQuery
     */
    private setSearchPeriodsQuery(option: apid.RuleSearchOption, query: FindQuery): void {
        if (typeof option.searchPeriods === 'undefined' || option.searchPeriods.length === 0) {
            return;
        }

        const or: string[] = [];
        for (let i = 0; i < option.searchPeriods.length; i++) {
            const startAtColumn = `sarchPeriodsStartAt${i}`;
            const endAtColumn = `sarchPeriodsEndAt${i}`;
            query.param[startAtColumn] = option.searchPeriods[i].startAt;
            query.param[endAtColumn] = option.searchPeriods[i].endAt;

            or.push(`(startAt >= :${startAtColumn} and startAt <= :${endAtColumn})`);
        }

        query.strs.push(DBUtil.createOrQuery(or));
    }

    /**
     * in query セット
     * @param query: FindQuery
     * @param column: 対象カラム名
     * @param values: 列挙する値
     */
    private createInQuery(query: FindQuery, column: string, values: any[]): void {
        if (values.length === 0) {
            return;
        }

        query.strs.push(`${column} in (:...${column})`);
        query.param[column] = values;
    }

    /**
     * overlap 用 query 文字列を生成
     * @param periodToAvoidDuplicate: 重複検索日数
     */
    private createOverlapQueryStr(periodToAvoidDuplicate: number | undefined): string {
        const period =
            typeof periodToAvoidDuplicate !== 'undefined' && periodToAvoidDuplicate > 0
                ? periodToAvoidDuplicate * 24 * 60 * 60 * 1000
                : 0;
        const now = new Date().getTime();
        let str =
            'case when id in ' +
            '(' +
            'select P.id from program as P, recorded_history as R ' +
            'where P.shortName = R.name ' +
            'and P.channelId = R.channelId ';

        // 重複検索日数
        if (period > 0) {
            str += `and R.endAt >= ${now - period} and R.endAt <= ${now} and P.endAt <= (R.endAt + ${period}) `;
        } else {
            str += `and R.endAt <= ${now} `;
        }

        str += ') then 1 else 0 end';

        return str;
    }

    /**
     * channel Id と開始時刻を指定して番組情報を取得する
     * @param channelId: apid.ChannelId
     * @param startAt: apid.UnixtimeMS
     * @return Promise<Program | null>
     */
    public async findChannelIdAndTime(channelId: apid.ChannelId, startAt: apid.UnixtimeMS): Promise<Program | null> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(Program);
        const result = await this.promieRetry.run(() => {
            return repository.find({
                channelId: channelId,
                // startAt <= time && endAt >= time
                startAt: LessThanOrEqual(startAt),
                endAt: MoreThanOrEqual(startAt),
            });
        });

        return result.length === 0 ? null : result[0];
    }

    /**
     * 全件取得
     * @return Promise<Program[]>
     */
    public async findAll(): Promise<Program[]> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(Program);

        return await this.promieRetry.run(() => {
            return repository.find({
                order: {
                    startAt: 'ASC',
                },
            });
        });
    }

    /**
     * 番組表データ取得
     * @param option: FindScheduleOption | FindScheduleIdOption
     * @return Promise<Program[]>
     */
    public async findSchedule(option: FindScheduleOption | FindScheduleIdOption): Promise<Program[]> {
        const connection = await this.op.getConnection();

        let queryOption: FindConditions<Program> | FindConditions<Program>[];

        if (typeof (<FindScheduleIdOption>option).channelId !== 'undefined') {
            queryOption = {
                startAt: LessThanOrEqual(option.endAt),
                endAt: MoreThanOrEqual(option.startAt),
                channelId: (<FindScheduleIdOption>option).channelId,
            };
        } else if (
            typeof (<FindScheduleOption>option).types !== 'undefined' &&
            (<FindScheduleOption>option).types.length > 0
        ) {
            queryOption = [];
            for (const type of (<FindScheduleOption>option).types) {
                queryOption.push({
                    startAt: LessThanOrEqual(option.endAt),
                    endAt: MoreThanOrEqual(option.startAt),
                    channelType: type,
                });
            }
        } else {
            throw new Error('FindScheduleOptionError');
        }

        const repository = connection.getRepository(Program);

        return await this.promieRetry.run(() => {
            return repository.find({
                where: queryOption,
                order: {
                    startAt: 'ASC',
                },
            });
        });
    }

    /**
     * 放映中の番組データを取得
     * @param option: apid.BroadcastingScheduleOption 加算時間 (ms)
     * @return Promise<Program[]>
     */
    public async findBroadcasting(option: apid.BroadcastingScheduleOption): Promise<Program[]> {
        let time = new Date().getTime();
        if (typeof option.time !== 'undefined') {
            time += option.time;
        }

        const connection = await this.op.getConnection();
        const repository = connection.getRepository(Program);

        return await this.promieRetry.run(() => {
            return repository.find({
                where: {
                    startAt: LessThanOrEqual(time),
                    endAt: MoreThanOrEqual(time),
                },
                order: {
                    startAt: 'ASC',
                },
            });
        });
    }
}
