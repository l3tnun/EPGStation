import * as path from 'path';
import Configuration from '../Configuration';

namespace Util {
    /**
    * config の dbType を返す
    * @return 'mysql' | 'sqlite3'
    */
    export const getDBType = (): 'mysql' | 'sqlite3' | 'postgresql' => {
        return Configuration.getInstance().getConfig().dbType || 'mysql';
    }

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
    * config の ffmpeg path を返す
    * @return string
    */
    export const getFFmpegPath = (): string => {
        return Configuration.getInstance().getConfig().ffmpeg || '/usr/local/bin/ffmpeg';
    }

    /**
    * config の streamFilePath を返す
    * @return string
    */
    export const getStreamFilePath = (): string => {
       return Configuration.getInstance().getConfig().streamFilePath || path.join(__dirname, '..', '..', '..', 'data', 'streamfiles');
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

    /**
    * windows の禁止文字列を置換
    * @param str: 文字列
    * @return string
    */
    export const replacePathName = (str: string): string => {
        return str
            .replace(/\\/g, '￥')
            .replace(/\¥/g, '￥')
            .replace(/\:/g, '：')
            .replace(/\*/g, '＊')
            .replace(/\?/g, '？')
            .replace(/\"/g, '”')
            .replace(/\</g, '＜')
            .replace(/\>/g, '＞')
            .replace(/\|/g, '｜')
            .replace(/\./g, '．')
    }
}

export default Util;

