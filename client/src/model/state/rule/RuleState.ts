import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import GenreUtil from '../../../util/GenreUtil';
import IRuleApiModel from '../../api/rule/IRuleApiModel';
import IChannelModel from '../../channels/IChannelModel';
import IRuleState, { RuleStateData } from './IRuleState';

@injectable()
export default class RuleState implements IRuleState {
    private channelModel: IChannelModel;
    private ruleApiModel: IRuleApiModel;

    private rule: apid.Rules | null = null;

    constructor(
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('IRuleApiModel') ruleApiModel: IRuleApiModel,
    ) {
        this.channelModel = channelModel;
        this.ruleApiModel = ruleApiModel;
    }

    /**
     * 取得したルール情報をクリア
     */
    public clearData(): void {
        this.rule = null;
    }

    /**
     * ルール情報を取得
     * @param option: apid.GetRuleOption
     * @return Promise<void>
     */
    public async fetchData(option: apid.GetRuleOption): Promise<void> {
        this.rule = await this.ruleApiModel.gets(option);
    }

    /**
     * 取得したルール情報を返す
     * @return RuleStateData[]
     */
    public getRules(): RuleStateData[] {
        return this.rule === null
            ? []
            : this.rule.rules.map(r => {
                  let channelStr = '';
                  if (typeof r.searchOption.channelIds === 'undefined' || r.searchOption.channelIds.length === 0) {
                      channelStr = '-';
                  } else {
                      const channel = this.channelModel.findChannel(r.searchOption.channelIds[0], true); // TODO 設定から読む
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
                              : GenreUtil.getSubGenre(
                                    r.searchOption.genres[0].genre,
                                    r.searchOption.genres[0].subGenre,
                                );

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
                          ignoreKeyword:
                              typeof r.searchOption.ignoreKeyword === 'undefined' ? '-' : r.searchOption.ignoreKeyword,
                          channels: channelStr,
                          genres: genreStr,
                          reservationsCnt: typeof r.reservesCnt === 'undefined' ? 0 : r.reservesCnt,
                      },
                      item: r,
                  };
              });
    }

    public getTotal(): number {
        return this.rule === null ? 0 : this.rule.total;
    }
}
