import internal from 'stream';
import * as apid from '../../../../api';

export interface IStreamBase<T> {
    setOption(option: T): void;
    start(streamId: apid.StreamId): Promise<void>;
    stop(): Promise<void>;
    getStream(): internal.Readable;
    getInfo(): apid.LiveStreamInfo | apid.RecordedStreamInfo;
    setExitStream(callback: () => void): void;
}
