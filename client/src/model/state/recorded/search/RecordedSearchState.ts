import IRuleApiModel from '@/model/api/rule/IRuleApiModel';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import GenreUtil from '../../../../util/GenreUtil';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IChannelModel from '../../../channels/IChannelModel';
import { ISettingStorageModel } from '../../../storage/setting/ISettingStorageModel';
import IRecordedSearchState, { SelectorItem } from './IRecordedSearchState';

@injectable()
class RecordedSearchState implements IRecordedSearchState {
    public keyword: string | undefined;
    public hasOriginalFile: boolean = false;
    public ruleId: apid.RuleId | null | undefined = null;
    public channelId: apid.ChannelId | undefined;
    public genre: apid.ProgramGenreLv1 | undefined;
    public ruleKeyword: string | null = null;
    public ruleItems: apid.RuleKeywordItem[] = [];
    public channelItems: SelectorItem[] = [];
    public genreItems: SelectorItem[] = [];

    private recordedApiModel: IRecordedApiModel;
    private ruleApiModel: IRuleApiModel;
    private channelModel: IChannelModel;
    private setting: ISettingStorageModel;
    private searchOptions: apid.RecordedSearchOptions | null = null;

    constructor(
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('IRuleApiModel') ruleApiModel: IRuleApiModel,
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('ISettingStorageModel') setting: ISettingStorageModel,
    ) {
        this.recordedApiModel = recordedApiModel;
        this.ruleApiModel = ruleApiModel;
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

        const keywordItems = await this.ruleApiModel.searchKeyword(this.createSearchKeywordOption());
        this.ruleItems.splice(-this.ruleItems.length);
        for (const k of keywordItems) {
            this.ruleItems.push(k);
        }

        await this.setRuleItemsByRuleId().catch(err => {
            console.error(err);
        });
    }

    /**
     * ruleItems に ruleId と同じ要素が存在しなかったら ruleItems に追加する
     * @return Promise<void>
     */
    private async setRuleItemsByRuleId(): Promise<void> {
        if (typeof this.ruleId === 'undefined' || this.ruleId === null) {
            return;
        }

        for (const r of this.ruleItems) {
            // すでに存在するので何もしない
            if (r.id === this.ruleId) {
                return;
            }
        }

        // ruleId と同じ要素が ruleItems に存在しなかったので追加する
        const rule = await this.ruleApiModel.get(this.ruleId);
        this.ruleItems.push({
            id: this.ruleId,
            keyword: typeof rule.searchOption.keyword === 'undefined' ? '' : rule.searchOption.keyword,
        });
    }

    /**
     * ルールのキーワード検索オプション生成
     * @return apid.GetRuleOption
     */
    private createSearchKeywordOption(): apid.GetRuleOption {
        const option: apid.GetRuleOption = {
            limit: RecordedSearchState.KEYWORD_SEARCH_LIMIT,
        };

        if (this.ruleKeyword !== null) {
            option.keyword = this.ruleKeyword;
        }

        return option;
    }

    /**
     * 各値の初期化
     */
    public initValues(): void {
        this.setItems();
        this.keyword = undefined;
        this.hasOriginalFile = false;
        this.ruleId = null;
        this.channelId = undefined;
        this.genre = undefined;
        this.ruleKeyword = null;
    }

    /**
     * items に値を詰め直す
     */
    private setItems(): void {
        // items クリア
        this.channelItems.splice(-this.channelItems.length);
        this.genreItems.splice(-this.genreItems.length);

        if (this.searchOptions === null) {
            return;
        }

        const isHalfWidth = this.setting.getSavedValue().isHalfWidthDisplayed;

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

    public async updateRuleItems(): Promise<void> {
        const keywordItems = await this.ruleApiModel.searchKeyword(this.createSearchKeywordOption());
        this.ruleItems = keywordItems;
    }
}

namespace RecordedSearchState {
    export const KEYWORD_SEARCH_LIMIT = 1000;
}

export default RecordedSearchState;
