import Hls from 'hls.js';
import UaUtil from './UaUtil';

namespace HLSUtil {
    /**
     * hls.js に対応しているか
     * @returns boolean 対応していれば true を返す
     */
    export const isSupportedHLSjs = (): boolean => {
        return UaUtil.isiOS() === true || (UaUtil.isMac() === true && UaUtil.isSafari() === true) ? false : Hls.isSupported();
    };
}

export default HLSUtil;
