import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';
import Reserve from '../../../db/entities/Reserve';

export default class Tuner {
    private types: apid.ChannelType[];
    private reserves: Reserve[] = [];

    constructor(tuner: mapid.TunerDevice) {
        this.types = tuner.types;
    }

    /**
     * 予約情報を追加
     * @return boolean 予約情報が追加できなかった場合 false
     */
    public add(reserve: Reserve): boolean {
        if (
            this.types.indexOf(<apid.ChannelType>reserve.channelType) !== -1 &&
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
