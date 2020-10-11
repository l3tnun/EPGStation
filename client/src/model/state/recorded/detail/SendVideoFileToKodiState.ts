import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import ISendVideoFileToKodiState from './ISendVideoFileToKodiState';

@injectable()
export default class SendVideoFileToKodiState implements ISendVideoFileToKodiState {
    public hostName: string | null = null;

    private serverConfig: IServerConfigModel;
    private videoApiModel: IVideoApiModel;

    constructor(@inject('IServerConfigModel') serverConfig: IServerConfigModel, @inject('IVideoApiModel') videoApiModel: IVideoApiModel) {
        this.serverConfig = serverConfig;
        this.videoApiModel = videoApiModel;
    }

    /**
     * 初期化
     */
    public init(hostName: string | null): void {
        // Storageから前回値を復元する
        this.hostName = hostName;

        // hostName の初期設定
        if (this.hostName === null) {
            const hosts = this.getHosts();

            if (hosts.length > 0) {
                this.hostName = hosts[0];
            }
        }
    }

    /**
     * kodi hosts を返す
     * @return string
     */
    public getHosts(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null || typeof config.kodiHosts === 'undefined' ? [] : config.kodiHosts;
    }

    /**
     * kodi にビデオリンクを送信する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async send(videoFileId: apid.VideoFileId): Promise<void> {
        if (this.hostName === null) {
            throw new Error('HostNameIsNull');
        }

        await this.videoApiModel.sendToKodi(this.hostName, videoFileId);
    }
}
