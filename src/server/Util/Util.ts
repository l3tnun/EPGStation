import * as path from 'path';
import Configuration from '../Configuration';

namespace Util {
    /**
    * config の recorded path を返す
    * @return string
    */
    export const getRecordedPath = (): string => {
        let recorded = Configuration.getInstance().getConfig().recorded;
        return (recorded || path.join(__dirname, '..', '..', '..', 'recorded')).replace(new RegExp('\\' + path.sep + '$'), '');
    }

    /**
    * config の thumbnail path を返す
    * @return string
    */
    export const getThumbnailPath = (): string => {
        let thumbnail = Configuration.getInstance().getConfig().thumbnail;
        return (thumbnail || path.join(__dirname, '..', '..', '..', 'thumbnail')).replace(new RegExp('\\' + path.sep + '$'), '');
    }

    /**
    * config の streamFilePath を返す
    * @return string
    */
    export const getStreamFilePath = (): string => {
       return Configuration.getInstance().getConfig().streamFilePath || path.join(__dirname, '..', '..', '..', 'data', 'streamfiles');
    }

    /**
    * config の continuousEPGUpdater を返す
    * 一度値が確定すると変更されない
    * @return boolean
    */
    let continuousEPGUpdater: boolean | null = null;
    export const isContinuousEPGUpdater = (): boolean => {
        if(continuousEPGUpdater === null) {
            continuousEPGUpdater = Configuration.getInstance().getConfig().continuousEPGUpdater || false;
        }

        return continuousEPGUpdater;
    }

    /**
    * sleep
    * @param msec: ミリ秒
    */
    export const sleep = (msec: number): Promise<void> => {
        return new Promise((resolve: () => void) => {
            setTimeout(() => { resolve(); }, msec);
        });
    }
}

export default Util;

