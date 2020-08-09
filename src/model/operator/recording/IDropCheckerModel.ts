import * as aribts from 'aribts';
import * as stream from 'stream';

export default interface IDropCheckerModel {
    start(logDirPath: string, srcFilePath: string, readableStream: stream.Readable): Promise<void>;
    stop(): Promise<void>;
    getFilePath(): string | null;
    getResult(): Promise<aribts.Result>;
}
