import type * as apid from '../../../../../api.js';
import IStreamBaseModel from './IStreamBaseModel.js';

/** 非HLSのライブ配信 stream（`LiveStreamModel`）を新規生成する factory の型。 */
export type LiveStreamModelProvider = () => Promise<ILiveStreamBaseModel>;
/** HLSのライブ配信 stream（`LiveHLSStreamModel`）を新規生成する factory の型。 */
export type LiveHLSStreamModelProvider = () => Promise<ILiveStreamBaseModel>;

/**
 * ライブ配信 stream の生成に必要な option。
 */
export interface LiveStreamOption {
    channelId: apid.ChannelId;
    /** エンコードコマンド。未指定の場合は mirakurun の stream をそのまま横流しする。 */
    cmd?: string;
}

/**
 * ライブ配信（`LiveStreamModel` / `LiveHLSStreamModel`）に共通する契約。
 * `IStreamBaseModel` を `LiveStreamOption` で specialize しただけで、追加の method は無い。
 */
export default interface ILiveStreamBaseModel extends IStreamBaseModel<LiveStreamOption> {
    setOption(option: LiveStreamOption, mode: number): void;
}
