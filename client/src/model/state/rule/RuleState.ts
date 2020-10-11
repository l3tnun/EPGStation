import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import GenreUtil from '../../../util/GenreUtil';
import IRuleApiModel from '../../api/rule/IRuleApiModel';
import IChannelModel from '../../channels/IChannelModel';
import IRuleState, { RuleFetchOption, RuleStateData } from './IRuleState';

interface SelectedIndex {
    [ruleId: number]: boolean;
}

@injectable()
export default class RuleState implements IRuleState {
    private channelModel: IChannelModel;
    private ruleApiModel: IRuleApiModel;

    private rules: RuleStateData[] | null = null;
    private total: number = 0;

    constructor(@inject('IChannelModel') channelModel: IChannelModel, @inject('IRuleApiModel') ruleApiModel: IRuleApiModel) {
        this.channelModel = channelModel;
        this.ruleApiModel = ruleApiModel;
    }

    /**
     * 取得したルール情報をクリア
     */
    public clearData(): void {
        this.rules = null;
    }

    /**
     * ルール情報を取得
     * @param option: RuleFetchOption
     * @return Promise<void>
     */
    public async fetchData(option: RuleFetchOption): Promise<void> {
        const result = await this.ruleApiModel.gets(option);

        const isSelectedIndex: SelectedIndex = {};
        if (this.rules !== null) {
            for (const r of this.rules) {
                isSelectedIndex[r.item.id] = r.isSelected;
            }
        }

        this.total = result.total;
        this.rules = result.rules.map(r => {
            return this.convertRuleItemToStateData(r, option.isHalfWidth, isSelectedIndex);
        });
    }

    /**
     * apid.Rule を RuleStateData へ変換する
     * @param rule: apid.Rule
     * @param isHalfWidth: boolean
     * @param isSelectedIndex: SelectedIndex
     * @return RuleStateData
     */
    private convertRuleItemToStateData(r: apid.Rule, isHalfWidth: boolean, isSelectedIndex: SelectedIndex): RuleStateData {
        let channelStr = '';
        if (typeof r.searchOption.channelIds === 'undefined' || r.searchOption.channelIds.length === 0) {
            channelStr = '-';
        } else {
            const channel = this.channelModel.findChannel(r.searchOption.channelIds[0], isHalfWidth);
            channelStr = channel === null ? r.searchOption.channelIds[0].toString(10) : channel.name;

            if (r.searchOption.channelIds.length > 1) {
                channelStr += ` 他${r.searchOption.channelIds.length - 1}`;
            }
        }

        let genreStr = '';
        if (typeof r.searchOption.genres === 'undefined' || r.searchOption.genres.length === 0) {
            genreStr = '-';
        } else {
            const genre =
                typeof r.searchOption.genres[0].subGenre === 'undefined'
                    ? GenreUtil.getGenre(r.searchOption.genres[0].genre)
                    : GenreUtil.getSubGenre(r.searchOption.genres[0].genre, r.searchOption.genres[0].subGenre);

            if (genre === null) {
                genreStr = '-';
            } else {
                genreStr = genre;
                if (r.searchOption.genres.length > 1) {
                    genreStr += ` 他${r.searchOption.genres.length - 1}`;
                }
            }
        }

        return {
            display: {
                id: r.id,
                isEnable: r.reserveOption.enable,
                keyword: typeof r.searchOption.keyword === 'undefined' ? '-' : r.searchOption.keyword,
                ignoreKeyword: typeof r.searchOption.ignoreKeyword === 'undefined' ? '-' : r.searchOption.ignoreKeyword,
                channels: channelStr,
                genres: genreStr,
                reservationsCnt: typeof r.reservesCnt === 'undefined' ? 0 : r.reservesCnt,
            },
            item: r,
            isSelected: typeof isSelectedIndex[r.id] === 'undefined' ? false : isSelectedIndex[r.id],
        };
    }

    /**
     * 取得したルール情報を返す
     * @return RuleStateData[]
     */
    public getRules(): RuleStateData[] {
        return this.rules === null ? [] : this.rules;
    }

    /**
     * ルール総数を返す
     * @return number
     */
    public getTotal(): number {
        return this.total;
    }

    /**
     * 選択した番組数を返す
     * @return number
     */
    public getSelectedCnt(): number {
        if (this.rules === null) {
            return 0;
        }

        let selectedCnt = 0;
        for (const r of this.rules) {
            if (r.isSelected === true) {
                selectedCnt++;
            }
        }

        return selectedCnt;
    }

    /**
     * 選択 (削除時の複数選択)
     * @param reserveId: apid.ReserveId
     */
    public select(reserveId: apid.ReserveId): void {
        if (this.rules === null) {
            return;
        }

        for (const r of this.rules) {
            if (r.item.id === reserveId) {
                r.isSelected = !r.isSelected;

                return;
            }
        }
    }

    /**
     * 全て選択 (削除時の複数選択)
     */
    public selectAll(): void {
        if (this.rules === null) {
            return;
        }

        let isUnselectAll = true;
        for (const r of this.rules) {
            if (r.isSelected === false) {
                isUnselectAll = false;
            }
            r.isSelected = true;
        }

        // 全て選択済みであれば選択を解除する
        if (isUnselectAll === true) {
            for (const r of this.rules) {
                r.isSelected = false;
            }
        }
    }

    /**
     * 全ての選択解除 (削除時の複数選択)
     */
    public clearSelect(): void {
        if (this.rules === null) {
            return;
        }

        for (const r of this.rules) {
            r.isSelected = false;
        }
    }

    /**
     * 選択したルールを削除する
     * @return Promise<void>
     */
    public async multiplueDeletion(): Promise<void> {
        if (this.rules === null) {
            return;
        }

        // 削除する video file を列挙する
        const reserveIds: apid.ReserveId[] = [];
        for (const r of this.rules) {
            if (r.isSelected === true) {
                reserveIds.push(r.item.id);
            }
        }

        // 選択状態を元に戻す
        this.clearSelect();

        // 列挙した予約をキャンセルする
        let hasError = false;
        for (const id of reserveIds) {
            try {
                await this.ruleApiModel.delete(id);
            } catch (err) {
                console.error(err);
                hasError = true;
            }
        }

        if (hasError === true) {
            throw new Error();
        }
    }
}
