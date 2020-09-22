import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import IRuleApiModel from '../../../..//model/api/rule/IRuleApiModel';
import GenreUtil from '../../../../util/GenreUtil';
import IChannelModel from '../../../channels/IChannelModel';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import ISettingStorageModel from '../../../storage/setting/ISettingStorageModel';
import { IRecordedUploadState, SelectorItem, VideoFileItem } from './IRecordedUploadState';

@injectable()
class RecordedUploadState implements IRecordedUploadState {
    public ruleId: apid.RuleId | null | undefined = null;
    public channelId: apid.ChannelId | undefined;
    public startAt: Date | null = null;
    public duration: number | null = null;
    public name: string | null = null;
    public description: string | null = null;
    public extended: string | null = null;
    public genre1: apid.ProgramGenreLv1 | undefined;
    public subGenre1: apid.ProgramGenreLv2 | undefined;
    public videoFileItems: VideoFileItem[] = [];

    public ruleKeyword: string | null = null;
    public ruleItems: apid.RuleKeywordItem[] = [];

    private settingModel: ISettingStorageModel;
    private channelModel: IChannelModel;
    private serverConfig: IServerConfigModel;
    private ruleApiModel: IRuleApiModel;

    private channelItems: SelectorItem[] = [];
    private genreItems: SelectorItem[] = [];
    private subGemreItems: SelectorItem[][] = [];

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('IRuleApiModel') ruleApiModel: IRuleApiModel,
    ) {
        this.serverConfig = serverConfig;
        this.settingModel = settingModel;
        this.channelModel = channelModel;
        this.ruleApiModel = ruleApiModel;

        this.genreItems = GenreUtil.getGenreListItems();
        for (let i = 0; i < GenreUtil.GENRE_MAX_NUM; i++) {
            this.subGemreItems.push(GenreUtil.getSubGenreListItems(i));
        }
    }

    /**
     * 各種変数初期化
     */
    public init(): void {
        this.ruleId = null;
        this.channelId = undefined;
        this.startAt = null;
        this.duration = null;
        this.name = null;
        this.description = null;
        this.extended = null;
        this.genre1 = undefined;
        this.subGenre1 = undefined;
        this.videoFileItems.splice(this.videoFileItems.length);
        this.addEmptyVideoFileItem();

        if (this.channelItems.length === 0) {
            const channels = this.channelModel.getChannels(this.settingModel.getSavedValue().isHalfWidthDisplayed);
            for (const c of channels) {
                this.channelItems.push({
                    text: c.name,
                    value: c.id,
                });
            }
        }
    }

    /**
     * 各種データ取得
     * @return Promise<void>
     */
    public async fetchData(): Promise<void> {
        await this.updateRuleItems();
    }

    /**
     * ルール item 更新
     */
    public async updateRuleItems(): Promise<void> {
        const keywordItems = await this.ruleApiModel.searchKeyword(this.createSearchKeywordOption());
        this.ruleItems.splice(-this.ruleItems.length);
        for (const k of keywordItems) {
            this.ruleItems.push(k);
        }
    }

    /**
     * ルールのキーワード検索オプション生成
     * @return apid.GetRuleOption
     */
    private createSearchKeywordOption(): apid.GetRuleOption {
        const option: apid.GetRuleOption = {
            limit: RecordedUploadState.KEYWORD_SEARCH_LIMIT,
        };

        if (this.ruleKeyword !== null) {
            option.keyword = this.ruleKeyword;
        }

        return option;
    }

    /**
     * 放送局 item を返す
     * @return SelectorItem[]
     */
    public getChannelItems(): SelectorItem[] {
        return this.channelItems;
    }

    /**
     * 親ディレクトリ item を返す
     * @return string[]
     */
    public getPrentDirectoryItems(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.recorded;
    }

    /**
     * ファイルタイプ item を返す
     * @return apid.VideoFileType[]
     */
    public getFileTypeItems(): apid.VideoFileType[] {
        return ['ts', 'encoded'];
    }

    /**
     * ジャンル item を返す
     * @return SelectorItem[]
     */
    public getGenreItems(): SelectorItem[] {
        return this.genreItems;
    }

    /**
     * サブジャンル items を返す
     * @return SelectorItem[]
     */
    public getSubGenreItems(): SelectorItem[] {
        return typeof this.genre1 === 'undefined' || this.genre1 < 0 || this.genre1 > GenreUtil.GENRE_MAX_NUM
            ? []
            : this.subGemreItems[this.genre1];
    }

    /**
     * videoFileItems に空要素追加
     */
    public addEmptyVideoFileItem(): void {
        this.videoFileItems.push({
            parentDirectoryName: undefined,
            subDirectory: null,
            viewName: null,
            fileType: undefined,
            file: null,
        });
    }

    /**
     * ファイルアップロード処理
     * @return Promise<void>
     */
    public async upload(): Promise<void> {
        // TODO 実装
    }
}

namespace RecordedUploadState {
    export const KEYWORD_SEARCH_LIMIT = 1000;
}

export default RecordedUploadState;
