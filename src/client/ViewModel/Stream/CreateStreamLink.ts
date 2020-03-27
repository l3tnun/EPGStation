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
        if (config === null || setting === null) { return null; }

        let baseUrl: string | null = null;

        // Mac Safari ではなくて Web 設定にて url scheme が有効
        if (!(Util.uaIsMac() && Util.uaIsSafari()) && setting.isEnableURLScheme) {
            // Web 設定に url scheme の設定があるか
            if (setting.customURLScheme === null) {
                // config に Viewer の設定がない
                if (typeof config.mpegTsViewer === 'undefined') { throw new Error('NotFoundViewerConfig'); }

                // connfig の設定を使用する
                if ((Util.uaIsiOS() || Util.uaIsiPadOS()) && typeof config.mpegTsViewer.ios !== 'undefined') {
                    baseUrl = config.mpegTsViewer.ios;
                } else if (Util.uaIsAndroid() && typeof config.mpegTsViewer.android !== 'undefined') {
                    baseUrl = config.mpegTsViewer.android;
                } else if (Util.uaIsMac() && typeof config.mpegTsViewer.mac !== 'undefined') {
                    baseUrl = config.mpegTsViewer.mac;
                } else if (Util.uaIsWindows() && typeof config.mpegTsViewer.win !== 'undefined') {
                    baseUrl = config.mpegTsViewer.win;
                }
            } else {
                // Web 設定を使用する
                baseUrl = setting.customURLScheme;
            }

            // ios or android で viewer の設定がなかった場合
            if (baseUrl === null && (Util.uaIsiOS() || Util.uaIsiPadOS() || Util.uaIsAndroid())) { throw new Error('NotFoundViewerApp'); }
        }

        if (baseUrl === null) {
            // url scheme 設定がないので playlist を返す
            return `./api/streams/live/${ channelId }/mpegts/playlist?mode=${ mode }`;
        } else {
            // url scheme 設定があったので使用する
            let source = `${ Util.getSubDirectory() }/api/streams/live/${ channelId }/mpegts?mode=${ mode }`;
            if (baseUrl.match(/vlc-x-callback/)) { source = encodeURIComponent(source); }

            return baseUrl.replace(/ADDRESS/g, location.host + source);
        }
    };
}

export default CreateStreamLink;

