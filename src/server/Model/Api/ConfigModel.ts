import * as apid from '../../../../node_modules/mirakurun/api';
import CreateMirakurunClient from '../../Util/CreateMirakurunClient';
import ApiModel from './ApiModel';

interface ConfigModelInterface extends ApiModel {
    getConfig(): Promise<{}>;
}

class ConfigModel extends ApiModel implements ConfigModelInterface {
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
        }

        const mirakurun = CreateMirakurunClient.get();
        const tuners = await mirakurun.getTuners();
        const broadcast = { GR: false, BS: false, CS: false, SKY: false };
        for (const tuner of tuners) {
            for (const key in broadcast) {
                if (tuner.types.indexOf(<apid.ChannelType> key) !== -1) {
                    broadcast[key] = true;
                }
            }
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
        }

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

        if (typeof config.recordedHLS !== 'undefined') {
            results['recordedHLS'] = config.recordedHLS.map((option) => {
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

