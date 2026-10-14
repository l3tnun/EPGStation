/**
 * Web・API側処理（子process）が開始した外部プロセスの種別。停止の方法が種別で決まる。
 * - `encode`: エンコード。
 * - `stream`: ライブ配信と録画ファイル配信の非HLSの視聴用変換。
 * - `hls`: HLS writer（独立したprocess groupのleader）。
 */
export type ServiceProcessKind = 'encode' | 'stream' | 'hls';

/**
 * 外部プロセスを開始する依頼元が添える処理種別。エンコードは依頼の識別番号、HLS writerは配信の識別番号を持つ。
 */
export type ServiceProcessDescriptor =
    | { readonly kind: 'encode'; readonly encodeId: number }
    | { readonly kind: 'stream' }
    | { readonly kind: 'hls'; readonly streamId: number };

/** 外部プロセスの開始の知らせの内容。HLS writerはPGIDも持つ。 */
export interface ServiceProcessStart {
    readonly pid: number;
    readonly kind: ServiceProcessKind;
    readonly pgid?: number;
    readonly encodeId?: number;
    readonly streamId?: number;
}

/**
 * Web・API側処理から管理側へ外部プロセスの開始と終了を知らせる窓口。応答を待たず、送れなかった知らせは
 * 記録して破棄する。
 */
export interface ServiceProcessReporter {
    started(start: ServiceProcessStart): void;
    ended(pid: number): void;
}
