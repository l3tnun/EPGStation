import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { genre1, genre2 } from '../../lib/event';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { RulesApiModelInterface } from '../../Model/Api/RulesApiModel';
import { ScheduleApiModelInterface } from '../../Model/Api/ScheduleApiModel';
import { SearchSettingValue } from '../../Model/Search/SearchSettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import StorageTemplateModel from '../../Model/Storage/StorageTemplateModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * SearchViewModel
 */
class SearchViewModel extends ViewModel {
    private scheduleApiModel: ScheduleApiModelInterface;
    private reservesApiModel: ReservesApiModelInterface;
    private rulesApiModel: RulesApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private searchSettingModel: StorageTemplateModel<SearchSettingValue>;
    private snackbar: SnackbarModelInterface;
    private config: ConfigApiModelInterface;
    private enableEncode: boolean = false;
    private encodeOption: string[] = [];
    private searchResults: apid.ScheduleProgramItem[] | null = null;
    private rule: apid.Rule | null = null;

    // scroll の状態
    public isNeedScroll: boolean = false;

    // RuleOption component とのやり取りで使われる
    public keyword: string = '';
    public ignoreKeyword: string = '';
    public keyCS: boolean = false;
    public keyRegExp: boolean = false;
    public title: boolean = false;
    public description: boolean = false;
    public extended: boolean = false;
    public ignoreKeyCS: boolean = false;
    public ignoreKeyRegExp: boolean = false;
    public ignoreTitle: boolean = false;
    public ignoreDescription: boolean = false;
    public ignoreExtended: boolean = false;
    public GR: boolean = true;
    public BS: boolean = true;
    public CS: boolean = true;
    public SKY: boolean = true;
    public station: number = 0;
    public genrelv1: apid.ProgramGenreLv1 = -1;
    public genrelv2: apid.ProgramGenreLv1 = -1;
    public startTime: number = 24;
    public timeRange: number = 1;
    public sun: boolean = true;
    public mon: boolean = true;
    public tue: boolean = true;
    public wed: boolean = true;
    public thu: boolean = true;
    public fri: boolean = true;
    public sat: boolean = true;
    public isFree: boolean = false;
    public durationMin: number = 0;
    public durationMax: number = 0;
    public avoidDuplicate: boolean = false;
    public periodToAvoidDuplicate: number = 0;
    public enable: boolean = true;
    public directory: string = '';
    public recordedFormat: string = '';
    public encodeModes: { mode: number; directory: string }[] = [
        { mode: -1, directory: '', },
        { mode: -1, directory: '', },
        { mode: -1, directory: '', },
    ];
    public delTs: boolean = false;

    constructor(
        scheduleApiModel: ScheduleApiModelInterface,
        reservesApiModel: ReservesApiModelInterface,
        rulesApiModel: RulesApiModelInterface,
        config: ConfigApiModelInterface,
        channels: ChannelsApiModelInterface,
        searchSettingModel: StorageTemplateModel<SearchSettingValue>,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.scheduleApiModel = scheduleApiModel;
        this.reservesApiModel = reservesApiModel;
        this.rulesApiModel = rulesApiModel;
        this.config = config;
        this.channels = channels;
        this.searchSettingModel = searchSettingModel;
        this.snackbar = snackbar;
    }

    /**
     * init
     * @param statu: ViewModelStatus
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if (status === 'reload' || status === 'updateIo') { return this.reloadUpdate(); }

        this.rule = null;
        this.isNeedScroll = false;
        this.initSearchOption();
        this.initAddOption();
        this.scheduleApiModel.init();
        this.reservesApiModel.init();
        this.clearSearchResults();
        if (typeof m.route.param('rule') !== 'undefined') {
            await this.rulesApiModel.fetchRule(Number(m.route.param('rule')));
            this.rule = this.rulesApiModel.getRule();
            if (this.rule !== null) {
                this.initSearchOption();
                this.initAddOption();
            }
        }

        if (this.rule === null && typeof m.route.param('rule') !== 'undefined') { return; }
        if (status === 'update') { m.redraw(); }

        await Util.sleep(100);
        await this.updateReserves();
        if (typeof m.route.param('rule') !== 'undefined' || typeof m.route.param('keyword') !== 'undefined') {
            Util.sleep(100)
            .then(() => {
                this.search();
            });
        }
    }

    /**
     * reload 時の更新
     */
    public async reloadUpdate(): Promise<void> {
        await this.updateReserves();
    }

    /**
     * init search option
     */
    public initSearchOption(): void {
        this.keyword = '';
        this.ignoreKeyword = '';
        this.keyCS = false;
        this.keyRegExp = false;
        this.title = false;
        this.description = false;
        this.extended = false;
        this.ignoreKeyCS = false;
        this.ignoreKeyRegExp = false;
        this.ignoreTitle = false;
        this.ignoreDescription = false;
        this.ignoreExtended = false;
        this.GR = true;
        this.BS = true;
        this.CS = true;
        this.SKY = true;
        this.station = 0;
        this.genrelv1 = -1;
        this.initGenre2();
        this.startTime = 24;
        this.timeRange = 1;
        this.sun = true;
        this.mon = true;
        this.tue = true;
        this.wed = true;
        this.thu = true;
        this.fri = true;
        this.sat = true;
        this.isFree = false;
        this.durationMin = 0;
        this.durationMax = 0;
        this.avoidDuplicate = false;
        this.periodToAvoidDuplicate = 0;

        if (this.rule !== null) {
            if (typeof this.rule.keyword !== 'undefined') { this.keyword = this.rule.keyword; }
            if (typeof this.rule.keyCS !== 'undefined') { this.keyCS = this.rule.keyCS; }
            if (typeof this.rule.keyRegExp !== 'undefined') { this.keyRegExp = this.rule.keyRegExp; }
            if (typeof this.rule.title !== 'undefined') { this.title = this.rule.title; }
            if (typeof this.rule.description !== 'undefined') { this.description = this.rule.description; }
            if (typeof this.rule.extended !== 'undefined') { this.extended = this.rule.extended; }

            if (typeof this.rule.ignoreKeyword !== 'undefined') { this.ignoreKeyword = this.rule.ignoreKeyword; }
            if (typeof this.rule.ignoreKeyCS !== 'undefined') { this.ignoreKeyCS = this.rule.ignoreKeyCS; }
            if (typeof this.rule.ignoreKeyRegExp !== 'undefined') { this.ignoreKeyRegExp = this.rule.ignoreKeyRegExp; }
            if (typeof this.rule.ignoreTitle !== 'undefined') { this.ignoreTitle = this.rule.ignoreTitle; }
            if (typeof this.rule.ignoreDescription !== 'undefined') { this.ignoreDescription = this.rule.ignoreDescription; }
            if (typeof this.rule.ignoreExtended !== 'undefined') { this.ignoreExtended = this.rule.ignoreExtended; }

            this.GR = typeof this.rule.GR === 'undefined' ? false : this.rule.GR;
            this.BS = typeof this.rule.BS === 'undefined' ? false : this.rule.BS;
            this.CS = typeof this.rule.CS === 'undefined' ? false : this.rule.CS;
            this.SKY = typeof this.rule.SKY === 'undefined' ? false : this.rule.SKY;

            if (typeof this.rule.station !== 'undefined') { this.station = this.rule.station; }
            if (typeof this.rule.genrelv1 !== 'undefined') { this.genrelv1 = this.rule.genrelv1; }
            if (typeof this.rule.genrelv2 !== 'undefined') { this.genrelv2 = this.rule.genrelv2; }
            if (typeof this.rule.startTime !== 'undefined') { this.startTime = this.rule.startTime; }
            if (typeof this.rule.timeRange !== 'undefined') { this.timeRange = this.rule.timeRange; }
            this.sun = ((this.rule.week & 0x01) !== 0);
            this.mon = ((this.rule.week & 0x02) !== 0);
            this.tue = ((this.rule.week & 0x04) !== 0);
            this.wed = ((this.rule.week & 0x08) !== 0);
            this.thu = ((this.rule.week & 0x10) !== 0);
            this.fri = ((this.rule.week & 0x20) !== 0);
            this.sat = ((this.rule.week & 0x40) !== 0);

            if (typeof this.rule.isFree !== 'undefined') { this.isFree = this.rule.isFree; }
            if (typeof this.rule.durationMin !== 'undefined') { this.durationMin = Math.floor(this.rule.durationMin / 60); }
            if (typeof this.rule.durationMax !== 'undefined') { this.durationMax = Math.floor(this.rule.durationMax / 60); }
            this.avoidDuplicate = this.rule.avoidDuplicate;
            if (typeof this.rule.periodToAvoidDuplicate !== 'undefined') { this.periodToAvoidDuplicate = this.rule.periodToAvoidDuplicate; }
        }

        if (typeof m.route.param('keyword') !== 'undefined') {
            this.keyword = m.route.param('keyword');
        }

        if (typeof m.route.param('type') !== 'undefined') {
            switch (m.route.param('type')) {
                case 'GR':
                    this.GR = true;
                    break;
                case 'BS':
                    this.BS = true;
                    break;
                case 'CS':
                    this.CS = true;
                    break;
                case 'SKY':
                    this.SKY = true;
                    break;
            }
        }

        if (typeof m.route.param('channel') !== 'undefined') {
            this.station = Number(m.route.param('channel'));
        }

        if (typeof m.route.param('genre1') !== 'undefined') {
            this.genrelv1 = Number(m.route.param('genre1'));
        }

        if (typeof m.route.param('genre2') !== 'undefined') {
            this.genrelv2 = Number(m.route.param('genre2'));
        }
    }

    /**
     * init add option
     */
    private initAddOption(): void {
        this.enable = true;
        this.directory = '';
        this.recordedFormat = '';
        this.encodeModes = [
            { mode: -1, directory: '', },
            { mode: -1, directory: '', },
            { mode: -1, directory: '', },
        ];
        this.delTs = false;

        if (this.rule !== null) {
            this.enable = this.rule.enable;
            if (typeof this.rule.directory !== 'undefined') { this.directory = this.rule.directory; }
            if (typeof this.rule.recordedFormat !== 'undefined') { this.recordedFormat = this.rule.recordedFormat; }
            if (typeof this.rule.mode1 !== 'undefined') { this.encodeModes[0].mode = this.rule.mode1; }
            if (typeof this.rule.directory1 !== 'undefined') { this.encodeModes[0].directory = this.rule.directory1; }
            if (typeof this.rule.mode2 !== 'undefined') { this.encodeModes[1].mode = this.rule.mode2; }
            if (typeof this.rule.directory2 !== 'undefined') { this.encodeModes[1].directory = this.rule.directory2; }
            if (typeof this.rule.mode3 !== 'undefined') { this.encodeModes[2].mode = this.rule.mode3; }
            if (typeof this.rule.directory3 !== 'undefined') { this.encodeModes[2].directory = this.rule.directory3; }
            if (typeof this.rule.delTs !== 'undefined') { this.delTs = this.rule.delTs; }
        }
    }

    /**
     * config から設定を読み込む
     */
    private setConfig(): void {
        const config = this.config.getConfig();
        if (config === null) { return; }

        this.enableEncode = config.enableEncode;
        this.encodeOption = this.enableEncode && typeof config.encodeOption !== 'undefined' ? config.encodeOption : [];
    }

    /**
     * 予約された program id を取得する
     */
    private async updateReserves(): Promise<void> {
        await this.reservesApiModel.fetchAllId();
    }

    /**
     * getReserve
     * @return program id を指定して状態を取得する
     */
    public getReserveStatus(programId: apid.ProgramId): 'reserve' | 'conflict' | 'skip' | 'overlap' | null {
        const reserves = this.reservesApiModel.getAllId();
        if (reserves === null || typeof reserves[programId] === 'undefined') { return null; }

        return reserves[programId].status;
    }

    /**
     * encode が有効か
     * @return true: 有効, false: 無効
     */
    public isEnableEncode(): boolean {
        return this.enableEncode;
    }

    /**
     * get encode option
     * @return encode option
     */
    public getEncodeOption(): string[] {
        return this.encodeOption;
    }

    /**
     * get channels
     * @return channels
     */
    public getChannels(): apid.ServiceItem[] {
        return this.channels.getChannels();
    }

    /**
     * get channels
     * @return channel
     */
    public getChannel(channelId: apid.ServiceItemId): apid.ServiceItem | null {
        return this.channels.getChannel(channelId);
    }

    /**
     * id を指定して channel 名を取得する
     * @param channelId: channel id
     * @return string
     */
    public getChannelName(channelId: apid.ServiceItemId): string {
        const channel = this.channels.getChannel(channelId);

        return channel === null ? String(channelId) : channel.name;
    }

    /**
     * get genre1
     * @return genre1
     */
    public getGenre1(): { value: number; name: string }[] {
        const result: { value: number; name: string }[] = [];
        for (let i = 0x0; i <= 0xF; i++) {
            if (genre1[i].length === 0) { continue; }
            result.push({ value: i, name: genre1[i] });
        }

        return result;
    }

    /**
     * get genre2
     * @return genre2
     */
    public getGenre2(): { value: number; name: string }[] {
        const result: { value: number; name: string }[] = [];
        if (typeof genre2[this.genrelv1] === 'undefined') { return []; }

        for (let i = 0x0; i <= 0xF; i++) {
            if (genre2[this.genrelv1][i].length === 0) { continue; }
            result.push({ value: i, name: genre2[this.genrelv1][i] });
        }

        return result;
    }

    /**
     * init genre2
     */
    public initGenre2(): void {
        this.genrelv2 = -1;
    }

    /**
     * search
     */
    public async search(): Promise<void> {
        // init での呼び出しだと config が null の場合があるため
        this.setConfig();
        this.settingOptions();

        if (this.rule === null) {
            const config = this.config.getConfig();
            const setting = this.searchSettingModel.getValue();
            // 設定の検索時にキーワードをコピーが有効な場合
            if (setting.setKeyowordToDirectory && this.keyword.length > 0) {
                this.directory = this.keyword;
                this.encodeModes[0].directory = this.keyword;
                this.encodeModes[1].directory = this.keyword;
                this.encodeModes[2].directory = this.keyword;
            }

            // デフォルトエンコード設定
            if (setting.setDefaultEncodeOption && config !== null) {
                if (typeof config.defaultEncode !== 'undefined') {
                    this.encodeModes[0].mode = config.defaultEncode;
                }
            }

            this.avoidDuplicate = setting.isEnableAvoidDuplicate;

            this.delTs = setting.delTs;
        }

        // 検索
        try {
            this.searchResults = await this.scheduleApiModel.search(this.createRuleSearch());
            this.isNeedScroll = true;
            m.redraw();
        } catch (err) {
            console.error(err);
            this.clearSearchResults();
            this.snackbar.open(`検索失敗: ${ err }`);
        }
    }

    /**
     * option を検索用に設定する
     */
    private settingOptions(): void {
        if (this.keyword.length === 0) {
            this.keyCS = false;
            this.keyRegExp = false;
            this.title = false;
            this.description = false;
            this.extended = false;
        } else if (this.keyword.length > 0 && (!this.title && !this.description && !this.extended)) {
            this.title = true;
            this.description = true;
        }

        if (this.ignoreKeyword.length === 0) {
            this.ignoreKeyCS = false;
            this.ignoreKeyRegExp = false;
            this.ignoreTitle = false;
            this.ignoreDescription = false;
            this.ignoreExtended = false;
        } else if (this.ignoreKeyword.length > 0 && (!this.ignoreTitle && !this.ignoreDescription && !this.ignoreExtended)) {
            this.ignoreTitle = true;
            this.ignoreDescription = true;
        }

        if (this.station !== 0) {
            this.GR = false;
            this.BS = false;
            this.CS = false;
            this.SKY = false;
        } else if (!this.GR && !this.BS && !this.CS && !this.SKY) {
            this.GR = true;
            this.BS = true;
            this.CS = true;
            this.SKY = true;
        }

        if (!this.sun && !this.mon && !this.tue && !this.wed && !this.thu && !this.fri && !this.sat) {
            this.sun = true;
            this.mon = true;
            this.tue = true;
            this.wed = true;
            this.thu = true;
            this.fri = true;
            this.sat = true;
        }

        if (this.durationMax <= this.durationMin) { this.durationMax = 0; }

        if (this.periodToAvoidDuplicate < 0) {
            this.periodToAvoidDuplicate = 0;
        }
    }

    /**
     * create RuleSearch
     * @return apid.RuleSearch
     */
    private createRuleSearch(): apid.RuleSearch {
        let week = 0;
        if (this.sun) { week += 0x01; }
        if (this.mon) { week += 0x02; }
        if (this.tue) { week += 0x04; }
        if (this.wed) { week += 0x08; }
        if (this.thu) { week += 0x10; }
        if (this.fri) { week += 0x20; }
        if (this.sat) { week += 0x40; }

        const option: apid.RuleSearch = {
            week: week,
        };

        if (this.keyword.length !== 0) { option.keyword = this.keyword; }
        if (this.ignoreKeyword.length !== 0) { option.ignoreKeyword = this.ignoreKeyword; }
        if (this.keyCS) { option.keyCS = this.keyCS; }
        if (this.keyRegExp) { option.keyRegExp = this.keyRegExp; }
        if (this.title) { option.title = this.title; }
        if (this.description) { option.description = this.description; }
        if (this.extended) { option.extended = this.extended; }
        if (this.ignoreKeyCS) { option.ignoreKeyCS = this.ignoreKeyCS; }
        if (this.ignoreKeyRegExp) { option.ignoreKeyRegExp = this.ignoreKeyRegExp; }
        if (this.ignoreTitle) { option.ignoreTitle = this.ignoreTitle; }
        if (this.ignoreDescription) { option.ignoreDescription = this.ignoreDescription; }
        if (this.ignoreExtended) { option.ignoreExtended = this.ignoreExtended; }
        if (this.GR) { option.GR = this.GR; }
        if (this.BS) { option.BS = this.BS; }
        if (this.CS) { option.CS = this.CS; }
        if (this.SKY) { option.SKY = this.SKY; }
        if (this.station !== 0) { option.station = this.station; }
        if (this.genrelv1 !== -1) { option.genrelv1 = this.genrelv1; }
        if (this.genrelv2 !== -1) { option.genrelv2 = this.genrelv2; }
        if (this.startTime !== 24) {
            option.startTime = this.startTime;
            option.timeRange = this.timeRange;
        }

        if (this.isFree) { option.isFree = true; }
        if (this.durationMin > 0) { option.durationMin = this.durationMin * 60; }
        if (this.durationMax > 0 && this.durationMax >= this.durationMin) { option.durationMax = this.durationMax * 60; }

        if (this.avoidDuplicate && this.periodToAvoidDuplicate >= 0) {
            option.avoidDuplicate = true;
            option.periodToAvoidDuplicate = this.periodToAvoidDuplicate;
        }

        return option;
    }

    /**
     * create RuleOption
     * @return RuleOption
     */
    private createRuleOption(): apid.RuleOption {
        const option: apid.RuleOption = { enable: this.enable };
        if (this.directory.length !== 0) { option.directory = this.directory; }
        if (this.recordedFormat.length !== 0) { option.recordedFormat = this.recordedFormat; }

        return option;
    }

    /**
     * create RuleEncode
     * @return RuleEncode
     */
    private createRuleEncode(): apid.RuleEncode | null {
        const option: apid.RuleEncode = {
            mode1: -1,
            delTs: this.delTs,
        };

        let modeCnt = 1;
        this.encodeModes.forEach((e) => {
            if (e.mode !== -1) {
                option[`mode${ modeCnt }`] = e.mode;
                if (e.directory.length !== 0) {
                    option[`directory${ modeCnt }`] = e.directory;
                }
                modeCnt += 1;
            }
        });

        if (option.mode1 === -1) { return null; }

        return option;
    }

    /**
     * create AddRule
     * @return AddRule
     */
    private createAddRule(): apid.AddRule {
        const addRule: apid.AddRule = {
            search: this.createRuleSearch(),
            option: this.createRuleOption(),
        };

        const encode = this.createRuleEncode();
        if (encode !== null) { addRule.encode = encode; }

        return addRule;
    }

    /**
     * get search results
     */
    public getSearchResults(): apid.ScheduleProgramItem[] | null {
        return this.searchResults;
    }

    /**
     * clear search items
     */
    public clearSearchResults(): void {
        this.searchResults = null;
    }

    /**
     * add rule
     */
    public async addRule(): Promise<void> {
        try {
            await this.rulesApiModel.add(this.createAddRule());
            this.snackbar.open('ルール追加');
            window.setTimeout(() => { Util.move('/rules'); }, 1000);
        } catch (err) {
            console.error(err);
            this.snackbar.open('ルール追加失敗');
        }
    }

    /**
     * update rule
     */
    public async updateRule(): Promise<void> {
        const ruleId = m.route.param('rule');
        if (typeof ruleId === 'undefined') {
            this.snackbar.open('ルールが指定されていません');

            return;
        }

        try {
            await this.rulesApiModel.update(Number(ruleId), this.createAddRule());
            this.snackbar.open('ルール更新');
            window.setTimeout(() => { Util.move('/rules'); }, 1000);
        } catch (err) {
            console.error(err);
            this.snackbar.open('ルール更新失敗');
        }
    }
}

namespace SearchViewModel {
    export const hitId = 'search-hit-id';
}

export default SearchViewModel;

