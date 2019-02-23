import * as apid from '../../../../node_modules/mirakurun/api';
import { IPCClientInterface } from '../IPC/IPCClient';
import ApiModel from './ApiModel';

interface ConfigModelInterface extends ApiModel {
    getConfig(): Promise<{}>;
}

class ConfigModel extends ApiModel implements ConfigModelInterface {
    private ipc: IPCClientInterface;

    constructor(
        ipc: IPCClientInterface,
    ) {
        super();
        this.ipc = ipc;
    }

    /**
     * config を取得
     * @return Promise<{}>
     */
    public async getConfig(): Promise<{}> {
        const results: {} = {};

        const config = this.config.getConfig();

        // basic 認証の情報を付加する
        if (typeof config.basicAuth !== 'undefined') {
            if (typeof config.recordedViewer !== 'undefined') {
                this.replaceBasicAuthAddress(config.basicAuth, config.recordedViewer);
            }
            if (typeof config.recordedDownloader !== 'undefined') {
                this.replaceBasicAuthAddress(config.basicAuth, config.recordedDownloader);
            }
            if (typeof config.mpegTsViewer !== 'undefined') {
                this.replaceBasicAuthAddress(config.basicAuth, config.mpegTsViewer);
            }
            if (typeof config.HLSViewer !== 'undefined') {
                this.replaceBasicAuthAddress(config.basicAuth, config.HLSViewer);
            }
        }

        const tuners = await this.ipc.getTuners();
        const broadcast = { GR: false, BS: false, CS: false, SKY: false };
        for (const tuner of tuners) {
            for (const key in broadcast) {
                if (tuner.types.indexOf(<apid.ChannelType> key) !== -1) {
                    broadcast[key] = true;
                }
            }
        }

        if (typeof config.recordedTSDefaultDirectory !== 'undefined') {
            results['recordedTSDefaultDirectory'] = config.recordedTSDefaultDirectory;
        }

        if (typeof config.encode === 'undefined') {
            results['enableEncode'] = false;
        } else {
            results['enableEncode'] = true;
            results['encodeOption'] = [];
            config.encode.forEach((e, i) => {
                if (Boolean(e.default)) {
                    results['defaultEncode'] = i;
                }
                results['encodeOption'].push(e.name);
            });

            results['delTs'] = typeof config.delts === 'undefined' ? false : config.delts;

            if (typeof config.recordedEncodeDefaultDirectory !== 'undefined') {
                results['recordedEncodeDefaultDirectory'] = config.recordedEncodeDefaultDirectory;
            }
        }

        results['enableLiveStreaming'] = typeof config.mpegTsStreaming !== 'undefined' || typeof config.liveHLS !== 'undefined' || typeof config.liveWebM !== 'undefined' || typeof config.liveMP4 !== 'undefined';

        results['broadcast'] = broadcast;

        if (typeof config.recordedViewer !== 'undefined') { results['recordedViewer'] = config.recordedViewer; }
        if (typeof config.recordedDownloader !== 'undefined') { results['recordedDownloader'] = config.recordedDownloader; }

        if (typeof config.mpegTsStreaming !== 'undefined') {
            results['mpegTsStreaming'] = config.mpegTsStreaming.map((option) => {
                return option.name;
            });

            if (typeof config.mpegTsViewer !== 'undefined') {
                results['mpegTsViewer'] = config.mpegTsViewer;
            }
        }

        if (typeof config.recordedStreaming !== 'undefined') {
            results['recordedStreaming'] = {};
            if (typeof config.recordedStreaming.mpegTs !== 'undefined') {
                results['recordedStreaming']['mpegTs'] = config.recordedStreaming.mpegTs.map((option) => {
                    return option.name;
                });
            }

            if (typeof config.recordedStreaming.webm !== 'undefined') {
                results['recordedStreaming']['webm'] = config.recordedStreaming.webm.map((option) => {
                    return option.name;
                });
            }

            if (typeof config.recordedStreaming.mp4 !== 'undefined') {
                results['recordedStreaming']['mp4'] = config.recordedStreaming.mp4.map((option) => {
                    return option.name;
                });
            }
        }

        if (typeof config.liveHLS !== 'undefined') {
            results['liveHLS'] = config.liveHLS.map((option) => {
                return option.name;
            });
        }

        if (typeof config.recordedHLS !== 'undefined') {
            results['recordedHLS'] = config.recordedHLS.map((option) => {
                return option.name;
            });
        }

        if (typeof config.HLSViewer !== 'undefined') { results['HLSViewer'] = config.HLSViewer; }

        if (typeof config.liveWebM !== 'undefined') {
            results['liveWebM'] = config.liveWebM.map((option) => {
                return option.name;
            });
        }

        if (typeof config.liveMP4 !== 'undefined') {
            results['liveMP4'] = config.liveMP4.map((option) => {
                return option.name;
            });
        }

        if (typeof config.kodiHosts !== 'undefined') {
            results['kodiHosts'] = config.kodiHosts.map((host) => {
                return host.name;
            });
        }

        return results;
    }

    /**
     * ADDRESS を user:password@ADDRESS に置き換える
     * @param info: { user: string; password: string }
     * @param config: { [key: string]: string }
     */
    private replaceBasicAuthAddress(info: { user: string; password: string }, config: { [key: string]: string }): void {
        for (const key in config) {
            config[key] = config[key].replace(/ADDRESS/g, `${ info.user }:${ info.password }@ADDRESS`);
        }
    }
}

export { ConfigModelInterface, ConfigModel };

