import * as apid from '../../../api';

/**
 * 追加されたビデオファイル情報
 */
export interface OperatorFinishEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId | null;
    mode: string; // エンコードモード名
}

export default interface IOperatorEncodeEvent {
    emitFinishEncode(info: OperatorFinishEncodeInfo): void;
    setFinishEncode(callback: (info: OperatorFinishEncodeInfo) => void): void;
}
