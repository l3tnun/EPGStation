import * as path from 'path';
// tslint:disable-next-line:no-require-imports
import urljoin = require('url-join');
import Configuration from '../Configuration';

namespace Util {
    /**
     * config の subDirectory を返す
     * @return string
     */
    export const getSubDirectory = (): string | null => {
        const sub = Configuration.getInstance().getConfig().subDirectory || null;

        return sub === null ? null : urljoin('/', sub).replace(new RegExp(`\\${ path.sep }$`), '');
    };

    /**
     * config の dbType を返す
     * @return 'mysql' | 'sqlite3'
     */
    export const getDBType = (): 'mysql' | 'sqlite3' | 'postgresql' => {
        return Configuration.getInstance().getConfig().dbType || 'mysql';
    };

    /**
     * config の recorded path を返す
     * @return string
     */
    export const getRecordedPath = (): string => {
        const recorded = Configuration.getInstance().getConfig().recorded;

        return (recorded || path.join(__dirname, '..', '..', '..', 'recorded')).replace(new RegExp(`\\${ path.sep }$`), '');
    };

    /**
     * config の recordedTmp path を返す
     * @return string
     */
    export const getRecordedTmpPath = (): string | null => {
        const recordedTmp = Configuration.getInstance().getConfig().recordedTmp;

        return typeof recordedTmp === 'undefined' ? null : recordedTmp.replace(new RegExp(`\\${ path.sep }$`), '');
    };

    /**
     * config の dropCheckLogDir を返す
     * @return string | null
     */
    export const getDropCheckLogDir = (): string | null => {
        const dropCheckLogDir = Configuration.getInstance().getConfig().dropCheckLogDir;

        return typeof dropCheckLogDir === 'undefined' ? null : dropCheckLogDir.replace(new RegExp(`\\${ path.sep }$`), '');
    };

    /**
     * config の thumbnail path を返す
     * @return string
     */
    export const getThumbnailPath = (): string => {
        const thumbnail = Configuration.getInstance().getConfig().thumbnail;

        return (thumbnail || path.join(__dirname, '..', '..', '..', 'thumbnail')).replace(new RegExp(`\\${ path.sep }$`), '');
    };

    /**
     * config の ffmpeg path を返す
     * @return string
     */
    export const getFFmpegPath = (): string => {
        return Configuration.getInstance().getConfig().ffmpeg || '/usr/local/bin/ffmpeg';
    };

    /**
     * config の ffprobe path を返す
     * @return string
     */
    export const getFFprobePath = (): string => {
        return Configuration.getInstance().getConfig().ffprobe || '/usr/local/bin/ffprobe';
    };

    /**
     * config の streamFilePath を返す
     * @return string
     */
    export const getStreamFilePath = (): string => {
       return Configuration.getInstance().getConfig().streamFilePath || path.join(__dirname, '..', '..', '..', 'data', 'streamfiles');
    };

    /**
     * sleep
     * @param msec: ミリ秒
     */
    export const sleep = (msec: number): Promise<void> => {
        return new Promise((resolve: () => void) => {
            setTimeout(() => { resolve(); }, msec);
        });
    };

    /**
     * windows のディレクトリ名での禁止文字列を置換
     * @param str: 文字列
     * @return string
     */
    export const replaceDirName = (str: string): string => {
        return str
            .replace(/\:/g, '：')
            .replace(/\*/g, '＊')
            .replace(/\?/g, '？')
            .replace(/\"/g, '”')
            .replace(/\</g, '＜')
            .replace(/\>/g, '＞')
            .replace(/\|/g, '｜')
            .replace(/\./g, '．');
    };

    /**
     * windows のファイル名での禁止文字列を置換
     * @param str: 文字列
     * @return string
     */
    export const replaceFileName = (str: string): string => {
        return Util.replaceDirName(str)
            .replace(/\//g, '／')
            .replace(/\\/g, '￥')
            .replace(/\¥/g, '￥');
    };

}

export default Util;

