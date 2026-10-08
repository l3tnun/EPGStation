import { ChildProcess, SpawnOptions } from 'child_process';

/** encodeプロセスを1つ起動するためのパラメータ。 */
export interface CreateProcessOption {
    input: string | null;
    output: string | null;
    cmd: string; // %INPUT% と %OUTPUT% を input と output で置換する
    priority: number; // 数値が大きいほど優先度が高くなる
    spawnOption?: SpawnOptions; // 全ての環境変数を渡す場合は spawnOption.env は null or undefined とすること
}

declare const managedProcessHandleBrand: unique symbol;

/**
 * `IEncodeProcessManageModel`が生成・管理するprocessを指す不透明な識別子（nominal typing用の
 * unique symbolでbrand化してあり、呼び出し側は`createManaged`/`createHlsWriter`が返したもの以外を
 * 構築できない）。内部の`ChildProcessInfo`実体へは実装内部の`WeakMap`でのみ解決される。
 */
export interface ManagedProcessHandle {
    readonly [managedProcessHandleBrand]: true;
}

/** `createManaged`の結果。生の`ChildProcess`と、以後の停止操作に使う`handle`の組。 */
export interface ManagedProcessStartResult {
    child: ChildProcess;
    handle: ManagedProcessHandle;
}

/** HLS writerプロセス（独立したprocess groupのleaderとして起動される）であることを表す`ManagedProcessHandle`。 */
export interface HlsWriterHandle extends ManagedProcessHandle {
    readonly kind: 'hls-writer';
}

/** `createHlsWriter`の結果。 */
export interface HlsWriterStartResult extends ManagedProcessStartResult {
    handle: HlsWriterHandle;
}

/**
 * `requestStop`の結果。
 * - `requested`: 停止要求（SIGINT）を送った。
 * - `already-released`: 対象が既に停止済み・解放済みだったため何も送らなかった（重複呼び出しへの冪等応答）。
 */
export type ManagedStopRequestResult =
    { status: 'requested'; sentSignals: ['SIGINT'] } | { status: 'already-released'; sentSignals: [] };

/**
 * `stopHls`の結果。
 * `exitConfirmed`はprocess group自体の終了をpollingで確認できたかどうか
 * （SIGINTで終了しなければSIGKILLを追送するため、`sentSignals`は複数件になり得る）。
 * `slotReleased`は常に`true`で、確認できたかに関わらずencode枠は必ず解放されることを表す。
 */
export interface HlsWriterStopResult {
    exitConfirmed: boolean;
    sentSignals: Array<'SIGINT' | 'SIGKILL'>;
    slotReleased: true;
}

/**
 * config の `encodeProcessNum` を上限とする同時実行枠（slot）でencodeプロセスを起動・管理する契約。
 * 実装は`EncodeProcessManageModel`。枠が埋まっている状態で新規要求が来た場合、要求の`priority`が
 * 実行中のいずれかより高ければ、その低優先度processを止めて枠を明け渡す（replacement）。
 * 明け渡す相手が無ければ起動要求自体を拒否する。
 */
export default interface IEncodeProcessManageModel {
    /**
     * encodeプロセスを起動する（旧来のraw `ChildProcess`のみを返す形。lifecycle管理された
     * handleへの移行が済んでいない既存の呼び出し元向けに維持されている）。
     * @param option 起動パラメータ。
     * @returns 起動した子process。
     */
    create(option: CreateProcessOption): Promise<ChildProcess>;
    /**
     * encodeプロセスを起動し、以後`requestStop`で停止できるhandle付きで返す。
     * @param option 起動パラメータ。
     * @returns 子processと、停止操作に使うhandleの組。
     */
    createManaged(option: CreateProcessOption): Promise<ManagedProcessStartResult>;
    /**
     * HLS writerプロセスを、独立したprocess groupのleaderとして起動する
     * （子孫processごと`stopHls`でまとめて止められるようにするため）。
     * @param option 起動パラメータ。
     * @returns 子processと、`stopHls`専用のhandleの組。
     */
    createHlsWriter(option: CreateProcessOption): Promise<HlsWriterStartResult>;
    /**
     * `createManaged`で得たhandleが指すprocessへSIGINTを送り、停止を要求する。
     * 同一handleに対する重複呼び出しは、進行中の最初の停止操作へ合流する。
     * @param handle 停止対象のhandle。
     * @returns 要求の送付結果（既に解放済みなら何もせずその旨を返す）。
     */
    requestStop(handle: ManagedProcessHandle): Promise<ManagedStopRequestResult>;
    /**
     * `createHlsWriter`で得たhandleが指すprocess group全体を停止する。SIGINTを送って一定回数
     * pollingし、終了しなければSIGKILLへ切り替える。
     * @param handle 停止対象のHLS writer handle。
     * @returns 停止結果。
     */
    stopHls(handle: HlsWriterHandle): Promise<HlsWriterStopResult>;
}
