import * as apid from '../../../../api';

export interface EncodeOption extends apid.AddEncodeProgramOption {
    encodeId: apid.EncodeId;
}

export interface EncodeProgressInfo {
    percent: number;
    log: string;
}

export type EncoderModelProvider = () => Promise<IEncoderModel>;

export interface IEncoderModel {
    setOption(encodeOption: EncodeOption): void;
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    start(): Promise<void>;
    cancel(): Promise<void>;
    getEncodeOption(): EncodeOption | null;
    getProgressInfo(): EncodeProgressInfo | null;
    getEncodeId(): apid.EncodeId | null;
}
