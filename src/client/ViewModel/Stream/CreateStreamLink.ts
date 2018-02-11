import * as apid from '../../../../api';
import Util from '../../Util/Util';

interface Setting {
    isEnableURLScheme: boolean;
    customURLScheme: string | null;
}

namespace CreateStreamLink {
    export const mpegTsStreamingLink = (
        config: apid.Config | null,
        setting: Setting | null,
        channelId: apid.ServiceItemId,
        mode: number,
    ): string | null => {
        if(config === null || setting === null) { return null; }

        let url = `/api/streams/live/${ channelId }/mpegts${ Util.uaIsMobile() ? '' : '/playlist' }?mode=${ mode }`;

        // Mac Safari では正しく解釈できないため m3u8 ファイルを開く
        if(Util.uaIsMac() && Util.uaIsSafari()) { return url; }

        if(setting.isEnableURLScheme) {
            // url scheme が有効
            let baseUrl: string | null = null;
            if(setting.customURLScheme === null) {
                // config に Viewer の設定がない
                if(typeof config.mpegTsViewer === 'undefined') { throw new Error('NotFoundViewerConfig'); }

                // config の設定を使用する
                if(Util.uaIsiOS() && typeof config.mpegTsViewer.ios !== 'undefined') { baseUrl = config.mpegTsViewer.ios; }
                else if(Util.uaIsAndroid() && typeof config.mpegTsViewer.android !== 'undefined') { baseUrl = config.mpegTsViewer.android; }
                else if(Util.uaIsMac()) {
                    if(typeof config.mpegTsViewer.mac !== 'undefined') { baseUrl = config.mpegTsViewer.mac; }
                    else { return url; }
                }
                else if(Util.uaIsWindows()) {
                    if(typeof config.mpegTsViewer.win !== 'undefined') { baseUrl = config.mpegTsViewer.win; }
                    else { return url; }
                }
            } else {
                // setting の設定を使用する
                baseUrl = setting.customURLScheme;
            }

            // viewer の設定がなかった場合
            if(baseUrl === null) { throw new Error('NotFoundViewerApp'); }

            if(baseUrl.match(/vlc-x-callback/)) { url = encodeURIComponent(url); }

            return baseUrl.replace(/ADDRESS/g, location.host + url);
        } else {
            // url scheme が無効
            return url;
        }
    }
}

export default CreateStreamLink;

