import { EventEmitter } from 'events';
import { ProgramId, TunerProgram, TunerService } from '../tuner/types.js';

/** 削除された番組を表す変更dataの最小情報（削除対象IDのみ）。 */
export interface RemoveProgram {
    id: ProgramId;
}
/** 番組IDが再定義（Mirakurunの再走査等で振り直し）されたことを表す変更data。 */
export interface RedefineProgram {
    from: ProgramId;
    to: ProgramId;
}

/**
 * `programQueue`に積まれる、番組変更イベントの共通形。`type`によって`data`の実際の形は
 * `CreateEvent`/`UpdateEvent`/`RemoveEvent`/`RedefineEvent`のいずれかに絞られる。
 */
export interface ProgramBaseEvent {
    resource: 'program';
    type: 'create' | 'update' | 'remove' | 'redefine';
    data: RedefineProgram | RemoveProgram | TunerProgram;
    time: number;
}

/** 番組新規作成イベント。 */
export interface CreateEvent extends ProgramBaseEvent {
    type: 'create';
    data: TunerProgram;
}

/** 番組更新イベント。 */
export interface UpdateEvent extends ProgramBaseEvent {
    type: 'update';
    data: TunerProgram;
}

/** 番組削除イベント。 */
export interface RemoveEvent extends ProgramBaseEvent {
    type: 'remove';
    data: RemoveProgram;
}

/** 番組ID再定義イベント。同一番組が別のIDへ振り直されたことを表す。 */
export interface RedefineEvent extends ProgramBaseEvent {
    type: 'redefine';
    data: RedefineProgram;
}

/** 放送局（サービス）の変更イベント。番組と異なり`create`/`update`/`remove`のみで`redefine`は無い。 */
export interface ServiceEvent {
    resource: 'service';
    type: 'create' | 'update' | 'remove';
    data: TunerService;
    time: number;
}

/**
 * `IEPGUpdateManageModel`（`EventEmitter`）が発行するイベント名。
 * `STREAM_STARTED`/`STREAM_ABORTED`はチューナーサーバーの変更フィード接続の開始・異常終了、
 * `PROGRAM_UPDATED`/`SERVICE_UPDATED`はDBへの反映が実際に行われた後に発行される。
 */
export namespace EPGUpdateEvent {
    export const STREAM_STARTED = 'event stream started';
    export const STREAM_ABORTED = 'event stream aborted';
    export const PROGRAM_UPDATED = 'program updated';
    export const SERVICE_UPDATED = 'service updated';
}

/**
 * EPG（番組表）情報をチューナーサーバー（Mirakurun/mirakc）から取得し、DBへ反映する処理全体の契約。
 * 実装は`EPGUpdateManageModel`。`start()`で変更フィードを購読しつつ、そこで溜まったキューを
 * `saveProgram`/`saveService`等の別呼び出し（定期実行）で実際にDBへ書き込む2段構成になっている。
 */
export default interface IEPGUpdateManageModel extends EventEmitter {
    /** 放送局・番組情報をチューナーサーバーから全件取得し直し、DBへ丸ごと反映する（起動時等の初期化用）。 */
    updateAll(): Promise<void>;
    /** 放送局（チャンネル）情報のみをチューナーサーバーから取得し直し、DBへ反映する。 */
    updateChannels(): Promise<void>;
    /**
     * チューナーサーバーの変更フィードへ接続し、以後の番組/放送局変更を`programQueue`/`serviceQueue`へ
     * 溜め続ける。接続が切れる・エラーになるまで解決しない（`STREAM_ABORTED`発行後にPromiseも終わる）。
     */
    start(): Promise<void>;
    /**
     * `start()`が溜めた番組変更キューをDBへ反映する。
     * @param timeThreshold 指定すると、キュー中に開始時刻がこの値より前の番組変更が無い限り実際の書き込みを
     *                       遅延させ、イベントをキューへ戻す（頻繁な変更をまとめて書き込むための間引き）。
     *                       省略時（0）は無条件に即座へ反映する。
     */
    saveProgram(timeThreshold?: number): Promise<void>;
    /** 現在時刻より過去の番組情報をDBから削除する。 */
    deleteOldPrograms(): Promise<void>;
    /** `start()`が溜めた放送局変更キューをDBへ反映する。 */
    saveService(): Promise<void>;
    /** mirakc固有の`on-air-service`通知で記録された、放映中番組が切り替わったサービスの番組情報を更新する。 */
    saveOnAirServices(): Promise<void>;
    /** mirakc固有の`service-programs-updated`通知で記録された、EPGが更新されたサービスの番組情報を更新する。 */
    saveUpdateServices(): Promise<void>;
}
