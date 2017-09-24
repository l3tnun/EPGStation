import * as apid from '../../../../api';
import Util from '../../Util/Util';

namespace CreateStreamLink {
    export const mpegTsStreamingLink = (
        config: apid.Config | null,
        channelId: apid.ServiceItemId,
        mode: number,
    ): string | null => {
        if(config === null) { return null; }

        if(!(Util.uaIsiOS() || Util.uaIsAndroid() || (Util.uaIsMac() && !Util.uaIsSafari() && typeof config.mpegTsViewer !== 'undefined' && typeof config.mpegTsViewer.mac !== 'undefined'))) {
            //プレイリストのリンクを返す
            return `/api/streams/live/${ channelId }/mpegts/playlist?mode=${ mode }`;
        }

        let baseUrl: string | null = null;
        if(typeof config.mpegTsViewer !== 'undefined') {
            if(Util.uaIsiOS() && typeof config.mpegTsViewer.ios !== 'undefined') { baseUrl = config.mpegTsViewer.ios; }
            if(Util.uaIsAndroid() && typeof config.mpegTsViewer.android !== 'undefined') { baseUrl = config.mpegTsViewer.android; }
            if(Util.uaIsMac() && !Util.uaIsSafari() && typeof config.mpegTsViewer.mac !== 'undefined') { baseUrl = config.mpegTsViewer.mac; }
        }

        // viewer が config.json に記述されていなかった場合
        if(baseUrl === null) {
            throw new Error('NotFoundViewerApp');
        }

        let url = `/api/streams/live/${ channelId }/mpegts?mode=${ mode }`;
        if(baseUrl.match(/vlc-x-callback/)) { url = encodeURIComponent(url); }

        return baseUrl.replace(/ADDRESS/g, location.host + url);
    }
}

export default CreateStreamLink;

