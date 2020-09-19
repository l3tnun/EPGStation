import * as apid from '../../../../../../api';

export default interface ISendVideoFileToKodiState {
    hostName: string | null;
    init(): void;
    getHosts(): string[];
    send(videoFileId: apid.VideoFileId): Promise<void>;
}
