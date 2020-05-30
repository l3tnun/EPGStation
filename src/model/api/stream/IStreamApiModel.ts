import internal from 'stream';
import * as apid from '../../../../api';

export interface StreamResponse {
    streamId: apid.StreamId;
    stream: internal.Readable;
}

export default interface IStreamApiModel {
    startM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    startWebmStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    startMp4Stream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    stop(streamId: apid.StreamId): Promise<void>;
    stopAll(): Promise<void>;
}
