import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import GenreUtil from '../../../../util/GenreUtil';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IChannelModel from '../../../channels/IChannelModel';
import ISettingStorageModel from '../../../storage/setting/ISettingStorageModel';
import IRecordedSearchState, { SelectorItem } from './IRecordedSearchState';

@injectable()
export default class RecordedSearchState implements IRecordedSearchState {
    public keyword: string | undefined;
    public ruleId: apid.RuleId | undefined;
    public channelId: apid.ChannelId | undefined;
    public genre: apid.ProgramGenreLv1 | undefined;
    public ruleItems: SelectorItem[] = [];
    public channelItems: SelectorItem[] = [];
    public genreItems: SelectorItem[] = [];

    private recordedApiModel: IRecordedApiModel;
    private channelModel: IChannelModel;
    private setting: ISettingStorageModel;
    private searchOptions: apid.RecordedSearchOptions | null = null;

    constructor(
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('ISettingStorageModel') setting: ISettingStorageModel,
    ) {
        this.recordedApiModel = recordedApiModel;
        this.channelModel = channelModel;
        this.setting = setting;
    }

    /**
     * 検索オプションを取得
     * @return Promise<void>
     */
    public async fetchData(): Promise<void> {
        const searchOption = await this.recordedApiModel.getSearchOptionList();
        this.searchOptions = searchOption;
    }

    /**
     * 各値の初期化
     */
    public initValues(): void {
        this.setItems();
        this.keyword = undefined;
        this.ruleId = undefined;
        this.channelId = undefined;
        this.genre = undefined;
    }

    /**
     * items に値を詰め直す
     */
    private setItems(): void {
        // items クリア
        this.ruleItems.splice(-this.ruleItems.length);
        this.channelItems.splice(-this.channelItems.length);
        this.genreItems.splice(-this.genreItems.length);

        if (this.searchOptions === null) {
            return;
        }

        const isHalfWidth = this.setting.getSavedValue().isRecordedHalfWidthDisplayed;

        for (const rule of this.searchOptions.rules) {
            this.ruleItems.push({
                text: `${rule.keyword}(${rule.cnt.toString(10)})`,
                value: rule.ruleId,
            });
        }
        for (const channel of this.searchOptions.channels) {
            const c = this.channelModel.findChannel(channel.channelId, isHalfWidth);
            const channelName = c === null ? channel.channelId.toString(10) : c.name;

            this.channelItems.push({
                text: `${channelName}(${channel.cnt.toString(10)})`,
                value: channel.channelId,
            });
        }
        for (const genre of this.searchOptions.genres) {
            const g = GenreUtil.getGenre(genre.genre);
            const genreStr = g === null ? genre.genre.toString(10) : g;

            this.genreItems.push({
                text: `${genreStr}(${genre.cnt.toString(10)})`,
                value: genre.genre,
            });
        }
    }

    /**
     * データ更新
     * @return Promise<void>
     */
    public async update(): Promise<void> {
        await this.fetchData();
        this.setItems();
    }
}
