import * as apid from '../../../../node_modules/mirakurun/api';
import Base from '../../Base';
import * as DBSchema from '../DB/DBSchema';

/**
 * Tuner
 * ResvationManager で使用する
 */
class Tuner extends Base {
    private types: apid.ChannelType[];
    private programs: DBSchema.ProgramSchema[] = [];

    constructor(tuner: apid.TunerDevice) {
        super();
        this.types = tuner.types;
    }

    /**
     * 予約情報を追加
     * @return boolean 予約情報が追加できなかった場合 false
     */
    public add(program: DBSchema.ProgramSchema): boolean {
        if (this.types.indexOf(program.channelType) !== -1 && (
            this.programs.length === 0
            || this.programs[0].channel === program.channel
        )) {
            this.programs.push(program);

            return true;
        }

        return false;
    }

    /**
     * 予約情報を全て削除
     */
    public clear(): void {
        this.programs = [];
    }
}

namespace Tuner {
    export const TunerIsNotEmptyError = 'TunerIsNotEmpty';
}

export default Tuner;

