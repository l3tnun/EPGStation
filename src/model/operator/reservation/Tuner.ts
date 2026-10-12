import Reserve from '../../../db/entities/Reserve.js';
import { BroadcastType, TunerInfo } from '../../tuner/types.js';

/**
 * 予約競合判定（`ReservationManageModel`）用の、チューナー1台分の割り当て状況を表す
 * シミュレーション用object。`ReservationManageModel.setTuners`で config のチューナー定義から
 * 生成され、判定パスのたびに`clear()`されてから、時刻順に走査した予約を`add()`で
 * 割り当てられるか試す。
 */
export default class Tuner {
    /**
     * このチューナーが対応する channel type。config のチューナー定義に固定され、以後変わらない。
     * `TunerInfo.types`（`BroadcastType[]`、GR/BS/CS/SKY/BS4Kおよび未知種別を含み得る）と同じ型に
     * 揃える。`apid.ChannelType`（`api.d.ts`、GR/BS/CS/SKY/BS4Kの5値）は`reserve.channelType`のapi
     * 公開型であり、`tuner.types`が実行時に持ち得る値の集合とは別物なので、こちらへ代入しない。
     */
    private types: BroadcastType[];
    /** 現在このチューナーに割り当て済みの予約。同一チューナーは同時に1つの `channel` しか
     *  受信できないため、2件目以降は`reserves[0]`と同じ`channel`のものしか追加できない。 */
    private reserves: Reserve[] = [];

    constructor(tuner: Pick<TunerInfo, 'types'>) {
        this.types = tuner.types;
    }

    /**
     * 予約情報を追加
     * @return boolean 予約情報が追加できなかった場合 false
     */
    public add(reserve: Reserve): boolean {
        if (
            this.types.indexOf(<BroadcastType>reserve.channelType) !== -1 &&
            (this.reserves.length === 0 || this.reserves[0].channel === reserve.channel)
        ) {
            this.reserves.push(reserve);

            return true;
        }

        return false;
    }

    /**
     * 予約情報を全て削除
     */
    public clear(): void {
        this.reserves = [];
    }
}
