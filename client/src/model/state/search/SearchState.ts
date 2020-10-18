import IReservesApiModel from '@/model/api/reserves/IReservesApiModel';
import IRuleApiModel from '@/model/api/rule/IRuleApiModel';
import { inject, injectable } from 'inversify';
import { cloneDeep } from 'lodash';
import * as apid from '../../../../../api';
import * as event from '../../../lib/event';
import DateUtil from '../../../util/DateUtil';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import IChannelModel from '../../channels/IChannelModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '../../storage/setting/ISettingStorageModel';
import IGuideProgramDialogState from '../guide/IGuideProgramDialogState';
import IGuideReserveUtil, { ReserveStateItemIndex } from '../guide/IGuideReserveUtil';
import IReserveStateUtil, { ReserveStateData } from '../reserve/IReserveStateUtil';
import ISearchState, {
    BroadcastWave,
    EncodedOption,
    GenreItem,
    KeywordOption,
    QuerySearchOption,
    ReserveOption,
    SaveOption,
    SearchOption,
    SearchResultItem,
    SelectorItem,
    SubGenreIndex,
    SubGenreItem,
    TimeReserveOption,
    Week,
} from './ISearchState';

@injectable()
export default class SearchState implements ISearchState {
    public isTimeSpecification: boolean = false;
    public searchOption: SearchOption | null = null;
    public timeReserveOption: TimeReserveOption | null = null;
    public reserveOption: ReserveOption | null = null;
    public saveOption: SaveOption | null = null;
    public encodeOption: EncodedOption | null = null;

    // vuetify-datetime-picker のリセットがうまくできないため一瞬 false にすることでクリアする
    public isShowPeriod: boolean = true;
    // ルールオプションのアコーディオンの開閉を行う
    public optionPanel: number[] = [];
    // ジャンル絞り込みプルダウン値
    public genreSelect: number = -1;

    private channelModel: IChannelModel;
    private serverConfig: IServerConfigModel;
    private scheduleApiModel: IScheduleApiModel;
    private ruleApiModel: IRuleApiModel;
    private reservesApiModel: IReservesApiModel;
    private reserveStateUtil: IReserveStateUtil;
    private reserveIndexUtil: IGuideReserveUtil;
    private programDialogState: IGuideProgramDialogState;
    private settingModel: ISettingStorageModel;

    private genreItems: GenreItem[] = [];
    private startTimeItems: SelectorItem[] = [];
    private rangeTimeItems: SelectorItem[] = [];

    private ruleId: apid.RuleId | null = null;

    private searchResult: SearchResultItem[] | null = null;
    private reservesResult: apid.ReserveItem[] | null = null;

    constructor(
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('IScheduleApiModel') scheduleApiModel: IScheduleApiModel,
        @inject('IRuleApiModel') ruleApiModel: IRuleApiModel,
        @inject('IReservesApiModel') reservesApiModel: IReservesApiModel,
        @inject('IReserveStateUtil') reserveStateUtil: IReserveStateUtil,
        @inject('IGuideReserveUtil') reserveIndexUtil: IGuideReserveUtil,
        @inject('IGuideProgramDialogState') programDialogState: IGuideProgramDialogState,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
    ) {
        this.channelModel = channelModel;
        this.serverConfig = serverConfig;
        this.scheduleApiModel = scheduleApiModel;
        this.ruleApiModel = ruleApiModel;
        this.reservesApiModel = reservesApiModel;
        this.reserveStateUtil = reserveStateUtil;
        this.reserveIndexUtil = reserveIndexUtil;
        this.programDialogState = programDialogState;
        this.settingModel = settingModel;

        // set genres
        for (const genre in event.Genre) {
            const subgenres = (event.SubGenre as any)[genre];
            if (typeof subgenres === 'undefined') {
                continue;
            }

            const subGenres: SubGenreItem[] = [];
            for (const s in subgenres) {
                if (subgenres[s].length === 0) {
                    continue;
                }
                subGenres.push({
                    name: subgenres[s],
                    value: parseInt(s, 10),
                });
            }
            this.genreItems.push({
                name: (event.Genre as any)[genre],
                value: parseInt(genre, 10),
                subGenres: subGenres,
            });
        }

        // set startTimeItems
        for (let i = 0; i <= 23; i++) {
            this.startTimeItems.push({
                text: `${i.toString(10)}時`,
                value: i,
            });
        }

        // set rangeTimeItems
        for (let i = 1; i <= 23; i++) {
            this.rangeTimeItems.push({
                text: `${i.toString(10)}時間`,
                value: i,
            });
        }
    }

    /**
     * 初期化
     */
    public async init(ruleId: apid.RuleId | null = null): Promise<void> {
        this.ruleId = ruleId;
        this.isTimeSpecification = false;
        this.initSearchOption();
        this.initTimeReserveOption();
        this.initReserveOption();
        this.initSaveOption();
        this.initEncodeOption();

        this.genreSelect = -1;

        this.programDialogState.close();

        // 検索結果クリア
        this.searchResult = null;
        this.reservesResult = null;

        if (this.ruleId !== null) {
            // ruleId を元にルール情報を取得する
            const rule = await this.ruleApiModel.get(this.ruleId);
            // 取得したルールを反映させる
            this.setRuleOption(rule);
        }

        this.initOptionPanel();
    }

    /**
     * 検索オプション初期化
     */
    private initSearchOption(): void {
        this.searchOption = {
            keyword: null,
            keywordOption: {
                keyCS: false,
                keyRegExp: false,
                name: false,
                description: false,
                extended: false,
            },
            ignoreKeyword: null,
            ignoreKeywordOption: {
                keyCS: false,
                keyRegExp: false,
                name: false,
                description: false,
                extended: false,
            },
            channels: [],
            broadcastWave: {
                GR: {
                    isEnable: true,
                    isShow: true,
                },
                BS: {
                    isEnable: true,
                    isShow: true,
                },
                CS: {
                    isEnable: true,
                    isShow: true,
                },
                SKY: {
                    isEnable: true,
                    isShow: true,
                },
            },
            genres: {},
            isShowSubgenres: true,
            startTime: undefined,
            rangeTime: undefined,
            week: {
                mon: true,
                tue: true,
                wed: true,
                thu: true,
                fri: true,
                sat: true,
                sun: true,
            },
            durationMin: null,
            durationMax: null,
            startPeriod: null,
            endPeriod: null,
            isFree: false,
        };

        // 放送波の表示をサーバの設定と合わせる
        const config = this.serverConfig.getConfig();
        if (config !== null) {
            if (config.broadcast.GR === false) {
                this.searchOption.broadcastWave.GR.isEnable = false;
                this.searchOption.broadcastWave.GR.isShow = false;
            }
            if (config.broadcast.BS === false) {
                this.searchOption.broadcastWave.BS.isEnable = false;
                this.searchOption.broadcastWave.BS.isShow = false;
            }
            if (config.broadcast.CS === false) {
                this.searchOption.broadcastWave.CS.isEnable = false;
                this.searchOption.broadcastWave.CS.isShow = false;
            }
            if (config.broadcast.SKY === false) {
                this.searchOption.broadcastWave.SKY.isEnable = false;
                this.searchOption.broadcastWave.SKY.isShow = false;
            }
        }

        // ジャンル
        for (const genreItem of this.genreItems) {
            const subGenreIndex: SubGenreIndex = {};
            for (const subGenreItem of genreItem.subGenres) {
                subGenreIndex[subGenreItem.value] = false;
            }

            this.searchOption.genres[genreItem.value] = {
                isEnable: false,
                subGenreIndex: subGenreIndex,
            };
        }
    }

    /**
     * 時刻予約オプション初期化
     */
    private initTimeReserveOption(): void {
        this.timeReserveOption = {
            keyword: null,
            channel: undefined,
            startTime: null,
            endTime: null,
            week: {
                mon: false,
                tue: false,
                wed: false,
                thu: false,
                fri: false,
                sat: false,
                sun: false,
            },
        };
    }

    /**
     * 予約プション初期化
     */
    private initReserveOption(): void {
        this.reserveOption = {
            enable: true,
            allowEndLack: true,
            avoidDuplicate: this.settingModel.getSavedValue().isCheckAvoidDuplicate,
            periodToAvoidDuplicate: null,
        };
    }

    /**
     * 保存オプション
     */
    private initSaveOption(): void {
        this.saveOption = {
            parentDirectoryName: null,
            directory: null,
            recordedFormat: null,
        };
    }

    /**
     * エンコードオプション
     */
    private initEncodeOption(): void {
        this.encodeOption = {
            mode1: null,
            encodeParentDirectoryName1: null,
            directory1: null,
            mode2: null,
            encodeParentDirectoryName2: null,
            directory2: null,
            mode3: null,
            encodeParentDirectoryName3: null,
            directory3: null,
            isDeleteOriginalAfterEncode: this.settingModel.getSavedValue().isCheckDeleteOriginalAfterEncode,
        };
    }

    /**
     * パネルの開閉を初期化する
     */
    private initOptionPanel(): void {
        this.optionPanel = [0, 1, 2, 3, 4, 7];

        if (this.encodeOption !== null) {
            // encode2 が空でない場合は開く
            if (this.encodeOption.mode2) {
                this.optionPanel.push(5);
            }

            // encode3 が空でない場合は開く
            if (this.encodeOption.mode3) {
                this.optionPanel.push(6);
            }
        }
    }

    /**
     * 渡された rule を反映させる
     * @param rule: apid.Rule
     */
    private setRuleOption(rule: apid.Rule): void {
        this.isTimeSpecification = rule.isTimeSpecification;
        if (this.isTimeSpecification === true) {
            this.setTimeReserveRuleSearchOption(rule.searchOption);
        } else {
            this.setSearchOption(rule.searchOption);
        }

        this.setReserveOption(rule.reserveOption);

        if (typeof rule.saveOption !== 'undefined') {
            this.setSaveOption(rule.saveOption);
        }

        if (typeof rule.encodeOption !== 'undefined') {
            this.setEncodeOption(rule.encodeOption);
        }
    }

    /**
     * timeReserveOption をセットする
     * @param searchOption: apid.RuleSearchOption
     */
    private setTimeReserveRuleSearchOption(searchOption: apid.RuleSearchOption): void {
        if (typeof searchOption.keyword === 'undefined') {
            throw new Error('keywordIsUndefined');
        }

        if (typeof searchOption.channelIds === 'undefined' || searchOption.channelIds.length === 0) {
            throw new Error('channelIdsIsUndefined');
        }

        if (typeof searchOption.times === 'undefined' || searchOption.times.length === 0) {
            throw new Error('timesIsUndefined');
        }

        for (const time of searchOption.times) {
            if (typeof time.start === 'undefined' || typeof time.range === 'undefined') {
                throw new Error('TimeOptionError');
            }
        }

        const start = searchOption.times[0].start;
        const range = searchOption.times[0].range;

        this.timeReserveOption = {
            keyword: searchOption.keyword,
            channel: searchOption.channelIds[0],
            startTime: typeof start === 'undefined' ? null : this.convertNumToTimepickerStr(start),
            endTime: typeof start === 'undefined' || typeof range === 'undefined' ? null : this.convertNumToTimepickerStr(start + range),
            week: this.convertRuleWeekToWeek(searchOption.times[0].week),
        };
    }

    /**
     * searchOption をセットする
     * @param searchOption: apid.RuleSearchOption
     */
    private setSearchOption(searchOption: apid.RuleSearchOption): void {
        if (this.searchOption === null) {
            throw new Error('searchOptionIsNull');
        }

        // キーワード
        if (typeof searchOption.keyword !== 'undefined') {
            this.searchOption.keyword = searchOption.keyword;
            this.searchOption.keywordOption = {
                keyCS: !!searchOption.keyCS,
                keyRegExp: !!searchOption.keyRegExp,
                name: !!searchOption.name,
                description: !!searchOption.description,
                extended: !!searchOption.extended,
            };
        }

        // 除外キーワード
        if (typeof searchOption.ignoreKeyword !== 'undefined') {
            this.searchOption.ignoreKeyword = searchOption.ignoreKeyword;
            this.searchOption.ignoreKeywordOption = {
                keyCS: !!searchOption.ignoreKeyRegExp,
                keyRegExp: !!searchOption.ignoreKeyRegExp,
                name: !!searchOption.ignoreName,
                description: !!searchOption.ignoreDescription,
                extended: !!searchOption.ignoreExtended,
            };
        }

        // 放送局
        if (typeof searchOption.channelIds !== 'undefined') {
            this.searchOption.channels = searchOption.channelIds.slice(0, searchOption.channelIds.length);
        } else {
            this.searchOption.broadcastWave.GR.isEnable = !!searchOption.GR;
            this.searchOption.broadcastWave.BS.isEnable = !!searchOption.BS;
            this.searchOption.broadcastWave.CS.isEnable = !!searchOption.CS;
            this.searchOption.broadcastWave.SKY.isEnable = !!searchOption.SKY;
        }

        // ジャンル
        if (typeof searchOption.genres !== 'undefined') {
            for (const genre of searchOption.genres) {
                // tslint:disable-next-line:prefer-conditional-expression
                if (typeof genre.subGenre === 'undefined') {
                    this.searchOption.genres[genre.genre].isEnable = true;
                } else {
                    this.searchOption.genres[genre.genre].isEnable = false;
                    this.searchOption.genres[genre.genre].subGenreIndex[genre.subGenre] = true;
                }
            }
        }

        // 時刻 (レンジ)
        if (typeof searchOption.times !== 'undefined' && searchOption.times.length > 0) {
            this.searchOption.startTime = searchOption.times[0].start;
            this.searchOption.rangeTime = searchOption.times[0].range;
            this.searchOption.week = this.convertRuleWeekToWeek(searchOption.times[0].week);
        }

        // 長さ
        if (typeof searchOption.durationMin !== 'undefined') {
            this.searchOption.durationMin = searchOption.durationMin * 60;
        }
        if (typeof searchOption.durationMax !== 'undefined') {
            this.searchOption.durationMax = searchOption.durationMax * 60;
        }

        // 期間
        if (typeof searchOption.searchPeriods !== 'undefined' && searchOption.searchPeriods.length > 0) {
            this.searchOption.startPeriod = new Date(searchOption.searchPeriods[0].startAt);
            this.searchOption.endPeriod = new Date(searchOption.searchPeriods[0].endAt);
        }

        // 無料放送か
        this.searchOption.isFree = !!searchOption.isFree;
    }

    /**
     * reserveOption をセットする
     * @param reserveOption: apidRuleReserveOption
     */
    private setReserveOption(reserveOption: apid.RuleReserveOption): void {
        if (this.reserveOption === null) {
            throw new Error('reserveOptionIsNull');
        }

        this.reserveOption.enable = reserveOption.enable;
        this.reserveOption.allowEndLack = reserveOption.allowEndLack;
        this.reserveOption.avoidDuplicate = reserveOption.avoidDuplicate;

        if (typeof reserveOption.periodToAvoidDuplicate !== 'undefined') {
            this.reserveOption.periodToAvoidDuplicate = reserveOption.periodToAvoidDuplicate;
        }
    }

    /**
     * saveOption をセットする
     * @param saveOption: apid.ReserveSaveOption
     */
    private setSaveOption(saveOption: apid.ReserveSaveOption): void {
        if (this.saveOption === null) {
            throw new Error('saveOptionIsNull');
        }

        if (typeof saveOption.parentDirectoryName !== 'undefined') {
            this.saveOption.parentDirectoryName = saveOption.parentDirectoryName;
        }

        if (typeof saveOption.directory !== 'undefined') {
            this.saveOption.directory = saveOption.directory;
        }

        if (typeof saveOption.recordedFormat !== 'undefined') {
            this.saveOption.recordedFormat = saveOption.recordedFormat;
        }
    }

    /**
     * encodeOption をセットする
     * @param encodeOption: apid.ReserveEncodedOption
     */
    private setEncodeOption(encodeOption: apid.ReserveEncodedOption): void {
        if (this.encodeOption === null) {
            throw new Error('encodeOptionIsNull');
        }

        if (typeof encodeOption.mode1 !== 'undefined') {
            this.encodeOption.mode1 = encodeOption.mode1;

            if (typeof encodeOption.encodeParentDirectoryName1 !== 'undefined') {
                this.encodeOption.encodeParentDirectoryName1 = encodeOption.encodeParentDirectoryName1;
            }
            if (typeof encodeOption.directory1 !== 'undefined') {
                this.encodeOption.directory1 = encodeOption.directory1;
            }
        }

        if (typeof encodeOption.mode2 !== 'undefined') {
            this.encodeOption.mode2 = encodeOption.mode2;

            if (typeof encodeOption.encodeParentDirectoryName2 !== 'undefined') {
                this.encodeOption.encodeParentDirectoryName2 = encodeOption.encodeParentDirectoryName2;
            }
            if (typeof encodeOption.directory2 !== 'undefined') {
                this.encodeOption.directory2 = encodeOption.directory2;
            }
        }

        if (typeof encodeOption.mode3 !== 'undefined') {
            this.encodeOption.mode3 = encodeOption.mode3;

            if (typeof encodeOption.encodeParentDirectoryName3 !== 'undefined') {
                this.encodeOption.encodeParentDirectoryName3 = encodeOption.encodeParentDirectoryName3;
            }
            if (typeof encodeOption.directory3 !== 'undefined') {
                this.encodeOption.directory3 = encodeOption.directory3;
            }
        }

        this.encodeOption.isDeleteOriginalAfterEncode = encodeOption.isDeleteOriginalAfterEncode;
    }

    /**
     * query による検索設定をセットする
     * @param query: QuerySearchOption
     */
    public setQueryOption(query: QuerySearchOption): void {
        if (this.searchOption === null) {
            throw new Error('SearchOptionIsNull');
        }

        if (typeof query.keyword !== 'undefined') {
            this.searchOption.keyword = query.keyword;
        }

        if (typeof query.channelId !== 'undefined') {
            this.searchOption.channels.push(query.channelId);
        }

        if (typeof query.genre !== 'undefined' && typeof this.searchOption.genres[query.genre] !== 'undefined') {
            if (typeof query.subGenre === 'undefined') {
                this.searchOption.genres[query.genre].isEnable = true;
                for (const subGenre in this.searchOption.genres[query.genre].subGenreIndex) {
                    this.searchOption.genres[query.genre].subGenreIndex[subGenre] = true;
                }
            } else if (typeof this.searchOption.genres[query.genre].subGenreIndex[query.subGenre] !== 'undefined') {
                this.searchOption.genres[query.genre].subGenreIndex[query.subGenre] = true;
            }
        }
    }

    /**
     * 入力項目をクリア
     */
    public clear(): void {
        this.initSearchOption();
        this.initTimeReserveOption();
        this.searchResult = null;
    }

    /**
     * 放送局 item を返す
     * @return SelectorItem[]
     */
    public getChannelItems(): SelectorItem[] {
        return this.channelModel.getChannels(this.settingModel.getSavedValue().isHalfWidthDisplayed).map(c => {
            return {
                text: c.name,
                value: c.id,
            };
        });
    }

    /**
     * ジャンル item を返す
     * @return GenreItem
     */
    public getGenreItems(): GenreItem[] {
        return this.genreItems;
    }

    /**
     * 時刻の開始時間 item を返す
     * @return SelectorItem[]
     */
    public getStartTimeItems(): SelectorItem[] {
        return this.startTimeItems;
    }

    /**
     * 時刻の時刻幅 item を返す
     * @return SelectorItem[]
     */
    public getRangeTimeItems(): SelectorItem[] {
        return this.rangeTimeItems;
    }

    /**
     * ジャンルクリック時の処理
     * @param genre: apid.ProgramGenreLv1
     */
    public onClickGenre(genre: apid.ProgramGenreLv1): void {
        if (this.searchOption === null || typeof this.searchOption.genres[genre] === 'undefined') {
            return;
        }

        const subGenreCnt = Object.keys(this.searchOption.genres[genre].subGenreIndex).length;
        if (this.searchOption.isShowSubgenres === true && subGenreCnt > 0) {
            const isEnable = this.getEnabledSubGenreCnt(genre) < subGenreCnt;

            this.searchOption.genres[genre].isEnable = isEnable;
            for (const subGenre in this.searchOption.genres[genre].subGenreIndex) {
                this.searchOption.genres[genre].subGenreIndex[subGenre] = isEnable;
            }
        } else {
            const isEnable = !this.searchOption.genres[genre].isEnable;
            this.searchOption.genres[genre].isEnable = isEnable;
            for (const subGenre in this.searchOption.genres[genre].subGenreIndex) {
                this.searchOption.genres[genre].subGenreIndex[subGenre] = isEnable;
            }
        }
    }

    /**
     * 指定されたジャンルの有効になっているサブジャンルの個数を返す
     * @param genre: apid.ProgramGenreLv1
     * @return number
     */
    private getEnabledSubGenreCnt(genre: apid.ProgramGenreLv1): number {
        if (this.searchOption === null || typeof this.searchOption.genres[genre] === 'undefined') {
            return 0;
        }

        let enabledSubGenreCnt = 0;
        for (const subGenre in this.searchOption.genres[genre].subGenreIndex) {
            if (this.searchOption.genres[genre].subGenreIndex[subGenre] === true) {
                enabledSubGenreCnt++;
            }
        }

        return enabledSubGenreCnt;
    }

    /**
     * サブジャンルクリック時の処理
     * @param genre: apid.ProgramGenreLv1
     * @param subGenre: apid.ProgramGenreLv2
     */
    public onClickSubGenre(genre: apid.ProgramGenreLv1, subGenre: apid.ProgramGenreLv2): void {
        if (
            this.searchOption === null ||
            typeof this.searchOption.genres[genre] === 'undefined' ||
            typeof this.searchOption.genres[genre].subGenreIndex[subGenre] === 'undefined'
        ) {
            return;
        }

        this.searchOption.genres[genre].subGenreIndex[subGenre] = !this.searchOption.genres[genre].subGenreIndex[subGenre];

        this.searchOption.genres[genre].isEnable = this.getEnabledSubGenreCnt(genre) >= Object.keys(this.searchOption.genres[genre].subGenreIndex).length;
    }

    /**
     * ジャンルクリア処理
     */
    public clearGenres(): void {
        if (this.searchOption === null) {
            return;
        }

        for (const genre in this.searchOption.genres) {
            this.searchOption.genres[genre].isEnable = false;
            for (const subGenre in this.searchOption.genres[genre].subGenreIndex) {
                this.searchOption.genres[genre].subGenreIndex[subGenre] = false;
            }
        }
    }

    /**
     * 検索準備
     */
    public prepSearch(): void {
        // 検索オプション準備
        this.prepSearchOption();

        // ディレクトリの自動設定
        if (this.settingModel.getSavedValue().isEnableCopyKeywordToDirectory === true) {
            if (this.searchOption !== null && this.saveOption !== null && this.isEditingRule() === false) {
                this.saveOption.directory = this.searchOption.keyword;
                this.saveOption = cloneDeep(this.saveOption);

                if (this.encodeOption !== null) {
                    this.encodeOption.directory1 = this.searchOption.keyword;
                }
            }
        }

        // エンコード設定
        if (this.settingModel.getSavedValue().isEnableEncodingSettingWhenCreateRule === true && this.encodeOption !== null) {
            const items = this.getEncodeModeItems();
            if (items.length > 0) {
                this.encodeOption.mode1 = items[0];
            }
        }
    }

    /**
     * searchOption の準備
     */
    private prepSearchOption(): void {
        if (this.searchOption === null) {
            throw new Error('searchOption is null');
        }

        // keyword
        if (this.searchOption.keyword === null) {
            this.searchOption.keywordOption.keyCS = false;
            this.searchOption.keywordOption.keyRegExp = false;
            this.searchOption.keywordOption.name = false;
            this.searchOption.keywordOption.description = false;
            this.searchOption.keywordOption.extended = false;
        } else if (this.isDisabledMainKeywordOption(this.searchOption.keywordOption) === true) {
            this.searchOption.keywordOption.name = true;
            this.searchOption.keywordOption.description = true;
        }

        // ignore keyword
        if (this.searchOption.ignoreKeyword === null) {
            this.searchOption.ignoreKeywordOption.keyCS = false;
            this.searchOption.ignoreKeywordOption.keyRegExp = false;
            this.searchOption.ignoreKeywordOption.name = false;
            this.searchOption.ignoreKeywordOption.description = false;
            this.searchOption.ignoreKeywordOption.extended = false;
        } else if (this.isDisabledMainKeywordOption(this.searchOption.ignoreKeywordOption) === true) {
            this.searchOption.ignoreKeywordOption.name = true;
            this.searchOption.ignoreKeywordOption.description = true;
        }

        // channels
        if (this.searchOption.channels.length > 0) {
            this.searchOption.broadcastWave.GR.isEnable = false;
            this.searchOption.broadcastWave.BS.isEnable = false;
            this.searchOption.broadcastWave.CS.isEnable = false;
            this.searchOption.broadcastWave.SKY.isEnable = false;
        } else if (this.isDisabledAllBroadcasWave(this.searchOption.broadcastWave)) {
            this.searchOption.broadcastWave.GR.isEnable = true;
            this.searchOption.broadcastWave.BS.isEnable = true;
            this.searchOption.broadcastWave.CS.isEnable = true;
            this.searchOption.broadcastWave.SKY.isEnable = true;
        }

        // time range
        if (typeof this.searchOption.startTime === 'undefined' || typeof this.searchOption.rangeTime === 'undefined') {
            this.searchOption.startTime = undefined;
            this.searchOption.rangeTime = undefined;
        }

        // week
        if (
            this.searchOption.week.mon === false &&
            this.searchOption.week.tue === false &&
            this.searchOption.week.wed === false &&
            this.searchOption.week.thu === false &&
            this.searchOption.week.fri === false &&
            this.searchOption.week.sat === false &&
            this.searchOption.week.sun === false
        ) {
            this.searchOption.week.mon = true;
            this.searchOption.week.tue = true;
            this.searchOption.week.wed = true;
            this.searchOption.week.thu = true;
            this.searchOption.week.fri = true;
            this.searchOption.week.sat = true;
            this.searchOption.week.sun = true;
        }

        // period
        if (this.searchOption.startPeriod === null || this.searchOption.endPeriod === null) {
            this.searchOption.startPeriod = null;
            this.searchOption.endPeriod = null;
        }
    }

    /**
     * keywordOption の name, description, extend すべてが有効になっていないか
     * @param option: KeywordOption
     * return boolean オプションが無効の場合は true を返す
     */
    private isDisabledMainKeywordOption(option: KeywordOption): boolean {
        return option.name === false && option.description === false && option.extended === false;
    }

    private isDisabledAllBroadcasWave(broadcas: BroadcastWave): boolean {
        if (broadcas.GR.isShow === true && broadcas.GR.isEnable === true) {
            return false;
        }

        if (broadcas.BS.isShow === true && broadcas.BS.isEnable === true) {
            return false;
        }

        if (broadcas.CS.isShow === true && broadcas.CS.isEnable === true) {
            return false;
        }

        if (broadcas.SKY.isShow === true && broadcas.SKY.isEnable === true) {
            return false;
        }

        return true;
    }

    /**
     * 番組を検索し結果を取得する
     * @return Promise<void>
     */
    public async fetchSearchResult(): Promise<void> {
        if (this.searchOption === null) {
            throw new Error('searchOption is null');
        }

        const scheduleSearchOption = this.createScheduleSearchOption(this.searchOption);
        const newResult = await this.scheduleApiModel.getScheduleSearch(scheduleSearchOption);
        const reserveIndex = await this.getReserveIndex(newResult);

        this.searchResult = newResult.map(p => {
            const startAt = DateUtil.getJaDate(new Date(p.startAt));
            const endAt = DateUtil.getJaDate(new Date(p.endAt));
            const channel = this.channelModel.findChannel(p.channelId, this.settingModel.getSavedValue().isHalfWidthDisplayed);
            const reserveType = typeof reserveIndex[p.id] === 'undefined' ? 'none' : reserveIndex[p.id].type;

            const result: SearchResultItem = {
                display: {
                    channelName: channel === null ? p.channelId.toString(10) : channel.name,
                    name: p.name,
                    day: DateUtil.format(startAt, 'MM/dd'),
                    dow: DateUtil.format(startAt, 'w'),
                    startTime: DateUtil.format(startAt, 'hh:mm'),
                    endTime: DateUtil.format(endAt, 'hh:mm'),
                    duration: Math.floor((p.endAt - p.startAt) / 1000 / 60),
                    description: p.description,
                    extended: p.extended,
                    reserveType: reserveType,
                },
                channel: channel,
                program: p,
            };

            if (typeof reserveIndex[p.id] !== 'undefined') {
                result.reserve = {
                    type: reserveType,
                    reserveId: reserveIndex[p.id].item.reserveId,
                    ruleId: reserveIndex[p.id].item.ruleId,
                };
            }

            return result;
        });
    }

    /**
     * ReserveStateItemIndex を取得する
     * @param items: apid.ScheduleProgramItem[]
     * @return Promise<ReserveStateItemIndex>
     */
    private async getReserveIndex(items: apid.ScheduleProgramItem[]): Promise<ReserveStateItemIndex> {
        const option = this.createGetReserveListOption(items);

        if (option === null) {
            return {};
        }

        return await this.reserveIndexUtil.getReserveIndex(option);
    }

    /**
     * apid.ScheduleProgramItem[] から apid.GetReserveListsOption を生成する
     * @param items: apid.ScheduleProgramItem[]
     * @return apid.GetReserveListsOption | null items がからの場合は null を返す
     */
    private createGetReserveListOption(items: apid.ScheduleProgramItem[]): apid.GetReserveListsOption | null {
        if (items.length === 0) {
            return null;
        }

        const option: apid.GetReserveListsOption = {
            startAt: items[0].startAt,
            endAt: items[0].endAt,
        };

        for (const item of items) {
            if (option.startAt > item.startAt) {
                option.startAt = item.startAt;
            }

            if (option.endAt < item.endAt) {
                option.endAt = item.endAt;
            }
        }

        return option;
    }

    /**
     * SearchOption から apid.ScheduleSearchOption を生成する
     * @param option: SearchOption
     * @return apid.ScheduleSearchOption
     */
    private createScheduleSearchOption(option: SearchOption): apid.ScheduleSearchOption {
        return {
            option: this.createRuleSearchOption(option),
            isHalfWidth: this.settingModel.getSavedValue().isHalfWidthDisplayed,
            limit: this.settingModel.getSavedValue().searchLength,
        };
    }

    /**
     * SearchOption から apid.RuleSearchOption を生成する
     * @param option: SearchOption
     * @return apid.RuleSearchOption
     */
    private createRuleSearchOption(option: SearchOption): apid.RuleSearchOption {
        const ruleOption: apid.RuleSearchOption = {};
        // keyword
        if (option.keyword !== null) {
            ruleOption.keyword = option.keyword;
            ruleOption.keyCS = option.keywordOption.keyCS;
            ruleOption.keyRegExp = option.keywordOption.keyRegExp;
            ruleOption.name = option.keywordOption.name;
            ruleOption.description = option.keywordOption.description;
            ruleOption.extended = option.keywordOption.extended;
        }

        // ignore keyword
        if (option.ignoreKeyword !== null) {
            ruleOption.ignoreKeyword = option.ignoreKeyword;
            ruleOption.ignoreKeyCS = option.ignoreKeywordOption.keyCS;
            ruleOption.ignoreKeyRegExp = option.ignoreKeywordOption.keyRegExp;
            ruleOption.ignoreName = option.ignoreKeywordOption.name;
            ruleOption.ignoreDescription = option.ignoreKeywordOption.description;
            ruleOption.ignoreExtended = option.ignoreKeywordOption.extended;
        }

        // channels
        if (option.channels.length > 0) {
            ruleOption.channelIds = option.channels;
        } else if (this.isEnabledAllBroadcasWave(option.broadcastWave) === false) {
            if (option.broadcastWave.GR.isShow === true) {
                ruleOption.GR = option.broadcastWave.GR.isEnable;
            }
            if (option.broadcastWave.BS.isShow === true) {
                ruleOption.BS = option.broadcastWave.BS.isEnable;
            }
            if (option.broadcastWave.CS.isShow === true) {
                ruleOption.CS = option.broadcastWave.CS.isEnable;
            }
            if (option.broadcastWave.SKY.isShow === true) {
                ruleOption.SKY = option.broadcastWave.SKY.isEnable;
            }
        }

        // genres
        const genres: apid.Genre[] = [];
        for (const genre in option.genres) {
            if (option.genres[genre].isEnable === true) {
                genres.push({
                    genre: parseInt(genre, 10),
                });
                continue;
            }

            for (const subGenre in option.genres[genre].subGenreIndex) {
                if (option.genres[genre].subGenreIndex[subGenre] === true) {
                    genres.push({
                        genre: parseInt(genre, 10),
                        subGenre: parseInt(subGenre, 10),
                    });
                }
            }
        }
        if (genres.length > 0) {
            ruleOption.genres = genres;
        }

        // time
        ruleOption.times = [
            {
                week: this.convertWeekToRuleWeek(option.week),
            },
        ];
        if (typeof option.startTime !== 'undefined' && typeof option.rangeTime !== 'undefined') {
            ruleOption.times[0].start = option.startTime;
            ruleOption.times[0].range = option.rangeTime;
        }

        // isFree
        if (option.isFree === true) {
            ruleOption.isFree = option.isFree;
        }

        // duration
        if (option.durationMin !== null) {
            ruleOption.durationMin = option.durationMin * 60;
        }
        if (option.durationMax !== null) {
            ruleOption.durationMax = option.durationMax * 60;
        }

        // periiod
        if (option.startPeriod !== null && option.endPeriod !== null) {
            ruleOption.searchPeriods = [
                {
                    startAt: option.startPeriod.getTime(),
                    endAt: option.endPeriod.getTime(),
                },
            ];
        }

        return ruleOption;
    }

    /**
     * 有効な放送波が全て有効か返す
     * @param broadcas: BroadcastWave
     * @return boolean true なら有効
     */
    private isEnabledAllBroadcasWave(broadcas: BroadcastWave): boolean {
        if (broadcas.GR.isShow === true && broadcas.GR.isEnable !== true) {
            return false;
        }

        if (broadcas.BS.isShow === true && broadcas.BS.isEnable !== true) {
            return false;
        }

        if (broadcas.CS.isShow === true && broadcas.CS.isEnable !== true) {
            return false;
        }

        if (broadcas.SKY.isShow === true && broadcas.SKY.isEnable !== true) {
            return false;
        }

        return true;
    }

    /**
     * Week を Rule の week に変換する
     * @param week: Week
     * @return number
     */
    private convertWeekToRuleWeek(week: Week): number {
        let weekNum = 0;
        if (week.sun === true) {
            weekNum += 0x01;
        }
        if (week.mon === true) {
            weekNum += 0x02;
        }
        if (week.tue === true) {
            weekNum += 0x04;
        }
        if (week.wed === true) {
            weekNum += 0x08;
        }
        if (week.thu === true) {
            weekNum += 0x10;
        }
        if (week.fri === true) {
            weekNum += 0x20;
        }
        if (week.sat === true) {
            weekNum += 0x40;
        }

        return weekNum === 0 ? 0x7f : weekNum;
    }

    /**
     * Rule の week を Week に変換する
     * @param week: number
     * @return Week
     */
    private convertRuleWeekToWeek(week: number): Week {
        return {
            sun: (week & 0x01) !== 0,
            mon: (week & 0x02) !== 0,
            tue: (week & 0x04) !== 0,
            wed: (week & 0x08) !== 0,
            thu: (week & 0x10) !== 0,
            fri: (week & 0x20) !== 0,
            sat: (week & 0x40) !== 0,
        };
    }

    /**
     * 取得した検索結果を返す
     * @return SearchResultItem[] | null
     */
    public getSearchResult(): SearchResultItem[] | null {
        return this.searchResult;
    }

    /**
     * ルールの予約情報を取得する
     */
    public async fetchRuleReserves(): Promise<void> {
        if (this.ruleId === null) {
            throw new Error('RuleIdIsNull');
        }

        const result = await this.reservesApiModel.gets({
            type: 'all',
            isHalfWidth: this.settingModel.getSavedValue().isHalfWidthDisplayed,
            ruleId: this.ruleId,
        });

        this.reservesResult = result.reserves;
    }

    /**
     * 取得した予約情報を返す
     * @return apid.ReserveItem[]
     */
    public getRuleReservesResult(): ReserveStateData[] {
        return this.reservesResult === null
            ? []
            : this.reserveStateUtil.convertReserveItemsToStateDatas(this.reservesResult, this.settingModel.getSavedValue().isHalfWidthDisplayed);
    }

    /**
     * 録画先ディレクトリの一覧を返す
     * @return string[]
     */
    public getPrentDirectoryItems(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.recorded;
    }

    /**
     * エンコードモード一覧を返す
     * @return string
     */
    public getEncodeModeItems(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.encode;
    }

    /**
     * エンコードに対応しているか
     */
    public isEnableEncodeMode(): boolean {
        return this.getEncodeModeItems().length > 0;
    }

    /**
     * ルール編集か?
     * @return boolean true でルール編集
     */
    public isEditingRule(): boolean {
        return this.ruleId !== null;
    }

    /**
     * ルールの追加
     */
    public async addRule(): Promise<void> {
        await this.ruleApiModel.add(this.createAddRuleOption());
    }

    /**
     * ルール追加用のデータを生成する
     * @return apid.AddRuleOption
     */
    private createAddRuleOption(): apid.AddRuleOption {
        let rule: apid.AddRuleOption | null = null;

        if (this.isTimeSpecification === false) {
            if (this.searchOption === null) {
                throw new Error('SearchOptionIsNull');
            }
            if (this.reserveOption === null) {
                throw new Error('ReserveOptionIsNull');
            }

            rule = {
                isTimeSpecification: false,
                searchOption: this.createRuleSearchOption(this.searchOption),
                reserveOption: this.createRuleReserveOption(this.reserveOption),
            };
        } else {
            if (this.timeReserveOption === null) {
                throw new Error('TimeReserveOptionIsNull');
            }
            if (this.reserveOption === null) {
                throw new Error('ReserveOptionIsNull');
            }

            rule = {
                isTimeSpecification: true,
                searchOption: this.createTimeSpecificationRuleSearchOption(this.timeReserveOption),
                reserveOption: this.createRuleReserveOption(this.reserveOption),
            };
        }

        if (this.saveOption !== null) {
            rule.saveOption = this.createReserveSaveOption(this.saveOption);
        }

        if (this.encodeOption !== null) {
            rule.encodeOption = this.createReserveEncodedOption(this.encodeOption);
        }

        return rule;
    }

    /**
     * TimeReserveOption から apid.RuleSearchOption を生成する
     * @param option TimeReserveOption
     * @return apid.RuleSearchOption
     */
    private createTimeSpecificationRuleSearchOption(option: TimeReserveOption): apid.RuleSearchOption {
        if (option.keyword === null || typeof option.channel === 'undefined' || option.startTime === null || option.endTime === null) {
            throw new Error('TimeReserveOptionIsInvalidValue');
        }

        const start = this.convertTimepickerStrToNum(option.startTime);
        const end = this.convertTimepickerStrToNum(option.endTime);

        return {
            keyword: option.keyword,
            channelIds: [option.channel],
            times: [
                {
                    start: start,
                    range: start <= end ? end - start : 24 * 60 * 60 - (start - end),
                    week: this.convertWeekToRuleWeek(option.week),
                },
            ],
        };
    }

    /**
     * Timepicker の入力値を秒に変換
     * @param timeStr: string
     * @return number
     */
    private convertTimepickerStrToNum(timeStr: string): number {
        const times = timeStr.split(':');

        if (times.length < 2) {
            throw new Error('TimePickerValueIsIncorrect');
        }

        return parseInt(times[0], 10) * 60 * 60 + parseInt(times[1], 10) * 60;
    }

    /**
     * number を timpicker の入力に変換
     * @param num: number
     * @return string hh:mm
     */
    private convertNumToTimepickerStr(num: number): string {
        const hour = Math.floor(num / (60 * 60)) % 24;
        const min = Math.floor((num % (60 * 60)) / 60) % 60;

        return ('00' + hour).slice(-2) + ':' + ('00' + min).slice(-2);
    }

    /**
     * ReserveOption から apid.RuleReserveOption を生成する
     * @param option: ReserveOption
     * @return apid.RuleReserveOption
     */
    private createRuleReserveOption(option: ReserveOption): apid.RuleReserveOption {
        const reserveOption: apid.RuleReserveOption = {
            enable: option.enable,
            allowEndLack: option.allowEndLack,
            avoidDuplicate: option.avoidDuplicate,
        };

        if (option.periodToAvoidDuplicate !== null) {
            reserveOption.periodToAvoidDuplicate = parseInt(option.periodToAvoidDuplicate as any, 10);
        }

        return reserveOption;
    }

    /**
     * SaveOption から apid.ReserveSaveOption を生成する
     * @param option: SaveOption
     * @return apid.ReserveSaveOption
     */
    private createReserveSaveOption(option: SaveOption): apid.ReserveSaveOption {
        const saveOption: apid.ReserveSaveOption = {};

        if (option.parentDirectoryName !== null) {
            saveOption.parentDirectoryName = option.parentDirectoryName;
        }
        if (option.directory !== null) {
            saveOption.directory = option.directory;
        }
        if (option.recordedFormat !== null) {
            saveOption.recordedFormat = option.recordedFormat;
        }

        return saveOption;
    }

    /**
     * EncodedOption から apid.ReserveEncodedOption を生成する
     * @param option: EncodedOption
     * @return apid.ReserveEncodedOption
     */
    private createReserveEncodedOption(option: EncodedOption): apid.ReserveEncodedOption | undefined {
        const encodeOption: apid.ReserveEncodedOption = {
            isDeleteOriginalAfterEncode: option.isDeleteOriginalAfterEncode,
        };

        if (option.mode1 === null && option.mode2 === null && option.mode3 === null) {
            return;
        }

        if (option.mode1 !== null) {
            encodeOption.mode1 = option.mode1;
            if (option.encodeParentDirectoryName1 !== null) {
                encodeOption.encodeParentDirectoryName1 = option.encodeParentDirectoryName1;
            }
            if (option.directory1 !== null) {
                encodeOption.directory1 = option.directory1;
            }
        }

        if (option.mode2 !== null) {
            encodeOption.mode2 = option.mode2;
            if (option.encodeParentDirectoryName2 !== null) {
                encodeOption.encodeParentDirectoryName2 = option.encodeParentDirectoryName2;
            }
            if (option.directory2 !== null) {
                encodeOption.directory2 = option.directory2;
            }
        }

        if (option.mode3 !== null) {
            encodeOption.mode3 = option.mode3;
            if (option.encodeParentDirectoryName3 !== null) {
                encodeOption.encodeParentDirectoryName3 = option.encodeParentDirectoryName3;
            }
            if (option.directory3 !== null) {
                encodeOption.directory3 = option.directory3;
            }
        }

        return encodeOption;
    }

    /**
     * ルール更新
     */
    public async updateRule(): Promise<void> {
        if (this.ruleId === null) {
            throw new Error('RuleIdIsNull');
        }

        await this.ruleApiModel.update(this.ruleId, this.createAddRuleOption());
    }
}
