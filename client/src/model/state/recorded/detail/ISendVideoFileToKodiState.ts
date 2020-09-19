import * as apid from '../../../../../../api';

export default interface ISendVideoFileToKodiState {
    hostName: string | null;
    init(hostName: string | null): void;
    getHosts(): string[];
    send(videoFileId: apid.VideoFileId): Promise<void>;
}
