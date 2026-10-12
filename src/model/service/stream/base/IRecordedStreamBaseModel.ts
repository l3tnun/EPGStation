import type * as apid from '../../../../../api.js';
import { RecordedPlaybackSource } from '../../../operator/recorded/IRecordedPlaybackSourceProvider.js';
import IStreamBaseModel from './IStreamBaseModel.js';

/** 非HLSの録画済み配信 stream（`RecordedStreamModel`）を新規生成する factory の型。 */
export type RecordedStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;
/** HLSの録画済み配信 stream（`RecordedHLSStreamModel`）を新規生成する factory の型。 */
export type RecordedHLSStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;

/**
 * 録画済み配信 stream の生成に必要な option。
 */
export interface RecordedStreamOption {
    videoFileId: apid.VideoFileId;
    playPosition: number; // 再生位置(秒)
    cmd: string;
}

/**
 * 配信対象の録画済みファイルの情報。
 */
export interface VideoFileInfo {
    /** 再生時間（秒）。playPosition がこれを超える開始要求はエラーになる。 */
    duration: number;
    size: number;
    bitRate: number;
}

/**
 * 録画済み配信（`RecordedStreamModel` / `RecordedHLSStreamModel`）に共通する契約。
 * `IStreamBaseModel` に加え、配信元データの受け渡し（`setPlaybackSource` /
 * `adoptPlaybackSource`）を追加で持つ。
 */
export default interface IRecordedStreamBaseModel extends IStreamBaseModel<RecordedStreamOption> {
    setOption(option: RecordedStreamOption, mode: number): void;
    /**
     * 配信元データを設定する。専用の解放処理を持たない呼び出し元向けの簡易版で、
     * 内部的には no-op の release を渡した `adoptPlaybackSource` と同じ。
     */
    setPlaybackSource(source: RecordedPlaybackSource): void;
    /**
     * 配信元データを設定し、この stream の停止時に呼ぶべき解放処理（`release`）を受け取る。
     * 呼び出し元（`StreamManageModel` 経由で貸与元の lease を握っている側）が解放責任を持つ。
     */
    adoptPlaybackSource(source: RecordedPlaybackSource, release: () => Promise<void>): void;
}
