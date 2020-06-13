import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IConfigApiModel from './IConfigApiModel';

@injectable()
export default class ConfigApiModel implements IConfigApiModel {
    private configuration: IConfiguration;
    private ipc: IIPCClient;

    constructor(@inject('IConfiguration') configuration: IConfiguration, @inject('IIPCClient') ipc: IIPCClient) {
        this.configuration = configuration;
        this.ipc = ipc;
    }

    public async getConfig(): Promise<apid.Config> {
        const config = this.configuration.getConfig();

        const result: apid.Config = <any>{};
        result.socketIOPort =
            typeof config.clientSocketioPort !== 'undefined'
                ? config.clientSocketioPort
                : typeof config.socketioPort !== 'undefined'
                ? config.socketioPort
                : config.port;
        result.recorded = config.recorded.map(r => {
            return r.name;
        });

        result.encode = config.encode.map(e => {
            return e.name;
        });

        result.urlscheme = {
            m2ts: {
                ios: config.urlscheme.m2ts.ios,
                android: config.urlscheme.m2ts.android,
                mac: config.urlscheme.m2ts.mac,
                win: config.urlscheme.m2ts.win,
            },
            video: {
                ios: config.urlscheme.video.ios,
                android: config.urlscheme.video.android,
                mac: config.urlscheme.video.mac,
                win: config.urlscheme.video.win,
            },
            download: {
                ios: config.urlscheme.download.ios,
                android: config.urlscheme.download.android,
                mac: config.urlscheme.download.mac,
                win: config.urlscheme.download.win,
            },
        };

        result.broadcast = await this.ipc.reserveation.getBroadcastStatus();
        result.isEnableLiveStream = false;
        result.isEnableTSRecordedStream = false;
        result.isEnableEncodedRecordedStream = false;

        if (typeof config.stream !== 'undefined') {
            result.streamConfig = {};

            // live stream
            if (typeof config.stream.live !== 'undefined') {
                result.isEnableLiveStream = true;
                result.streamConfig.live = {};
                if (typeof config.stream.live.m2ts !== 'undefined') {
                    result.streamConfig.live.m2ts = config.stream.live.m2ts.map(c => {
                        return c.name;
                    });
                }
                if (typeof config.stream.live.webm !== 'undefined') {
                    result.streamConfig.live.webm = config.stream.live.webm.map(c => {
                        return c.name;
                    });
                }
                if (typeof config.stream.live.mp4 !== 'undefined') {
                    result.streamConfig.live.mp4 = config.stream.live.mp4.map(c => {
                        return c.name;
                    });
                }
                if (typeof config.stream.live.hls !== 'undefined') {
                    result.streamConfig.live.hls = config.stream.live.hls.map(c => {
                        return c.name;
                    });
                }
            }

            // recorded stream
            if (typeof config.stream.recorded !== 'undefined') {
                result.streamConfig.recorded = {};
                // ts
                if (typeof config.stream.recorded.ts !== 'undefined') {
                    result.streamConfig.recorded.ts = {};
                    result.isEnableTSRecordedStream = true;
                    if (typeof config.stream.recorded.ts.webm !== 'undefined') {
                        result.streamConfig.recorded.ts.webm = config.stream.recorded.ts.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.ts.mp4 !== 'undefined') {
                        result.streamConfig.recorded.ts.mp4 = config.stream.recorded.ts.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.ts.hls !== 'undefined') {
                        result.streamConfig.recorded.ts.hls = config.stream.recorded.ts.hls.map(c => {
                            return c.name;
                        });
                    }
                }

                // encoded
                if (typeof config.stream.recorded.encoded !== 'undefined') {
                    result.streamConfig.recorded.encoded = {};
                    result.isEnableEncodedRecordedStream = true;
                    if (typeof config.stream.recorded.encoded.webm !== 'undefined') {
                        result.streamConfig.recorded.encoded.webm = config.stream.recorded.encoded.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.encoded.mp4 !== 'undefined') {
                        result.streamConfig.recorded.encoded.mp4 = config.stream.recorded.encoded.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.encoded.hls !== 'undefined') {
                        result.streamConfig.recorded.encoded.hls = config.stream.recorded.encoded.hls.map(c => {
                            return c.name;
                        });
                    }
                }
            }
        }

        return result;
    }
}
