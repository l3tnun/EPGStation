import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import IConfiguration from '../../IConfiguration.js';
import IIPCClient from '../../ipc/IIPCClient.js';
import IConfigApiModel from './IConfigApiModel.js';

/** `IConfigApiModel` の実装。詳細は `IConfigApiModel` を参照。 */
@injectable()
export default class ConfigApiModel implements IConfigApiModel {
    private configuration: IConfiguration;
    private ipc: IIPCClient;

    constructor(@inject('IConfiguration') configuration: IConfiguration, @inject('IIPCClient') ipc: IIPCClient) {
        this.configuration = configuration;
        this.ipc = ipc;
    }

    /**
     * コンフィグ設定を返す
     * @param isSecure: boolean https アクセスか?
     */
    public async getConfig(isSecure: boolean): Promise<apid.Config> {
        const config = this.configuration.getConfig();

        const result: apid.Config = <any>{};

        // socket.io ポート設定
        if (typeof config.clientSocketioPort !== 'undefined') {
            result.socketIOPort = config.clientSocketioPort;
        } else if (isSecure === true) {
            // https
            if (typeof config.https === 'undefined') {
                throw new Error('httpsConfigError');
            }

            result.socketIOPort =
                typeof config.https.socketioPort === 'undefined' ? config.https.port : config.https.socketioPort;
        } else {
            // http
            if (typeof config.port === 'undefined') {
                throw new Error('httpConfigError');
            }

            result.socketIOPort = typeof config.socketioPort === 'undefined' ? config.port : config.socketioPort;
        }

        result.recorded = config.recorded.map(r => {
            return r.name;
        });

        result.encode = config.encode.map(e => {
            return e.name;
        });

        // config.urlscheme とその m2ts / video / download は IConfigFile 上は必須だが、config.yml を
        // 手で編集した結果一部だけが欠落した場合でも 500 にせず「その項目の URL scheme を返さない」
        // 状態として扱えるよう、ここでも欠落に対して防御する
        // (`Configuration.setTemplateValues` が通常は補うが、二重に守る)。
        const urlscheme = config.urlscheme ?? ({} as Partial<typeof config.urlscheme>);
        const m2ts = urlscheme.m2ts ?? {};
        const video = urlscheme.video ?? {};
        const download = urlscheme.download ?? {};

        result.urlscheme = {
            m2ts: {
                ios: m2ts.ios,
                android: m2ts.android,
                mac: m2ts.mac,
                win: m2ts.win,
            },
            video: {
                ios: video.ios,
                android: video.android,
                mac: video.mac,
                win: video.win,
            },
            download: {
                ios: download.ios,
                android: download.android,
                mac: download.mac,
                win: download.win,
            },
        };

        result.broadcast = await this.ipc.reserveation.getBroadcastStatus();
        result.isEnableTSLiveStream = false;
        result.isEnableTSRecordedStream = false;
        result.isEnableEncodedRecordedStream = false;

        if (typeof config.stream !== 'undefined') {
            result.streamConfig = {};

            // live stream
            if (typeof config.stream.live !== 'undefined') {
                result.streamConfig.live = {};
                if (typeof config.stream.live.ts !== 'undefined') {
                    result.isEnableTSLiveStream = true;
                    result.streamConfig.live.ts = {};

                    if (typeof config.stream.live.ts.m2ts !== 'undefined') {
                        result.streamConfig.live.ts.m2ts = config.stream.live.ts.m2ts.map(c => {
                            return {
                                name: c.name,
                                isUnconverted: typeof c.cmd === 'undefined',
                            };
                        });
                    }
                    if (typeof config.stream.live.ts.m2tsll !== 'undefined') {
                        result.streamConfig.live.ts.m2tsll = config.stream.live.ts.m2tsll.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.webm !== 'undefined') {
                        result.streamConfig.live.ts.webm = config.stream.live.ts.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.mp4 !== 'undefined') {
                        result.streamConfig.live.ts.mp4 = config.stream.live.ts.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.hls !== 'undefined') {
                        result.streamConfig.live.ts.hls = config.stream.live.ts.hls.map(c => {
                            return c.name;
                        });
                    }
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

        if (typeof config.kodiHosts !== 'undefined') {
            result.kodiHosts = config.kodiHosts.map(k => {
                return k.name;
            });
        }

        return result;
    }
}
