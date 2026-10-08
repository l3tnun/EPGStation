import type * as apid from '../../../api.js';
import { AddVideoFileOption, UploadedVideoFileOption } from '../operator/recorded/IRecordedManageModel.js';
import { EncodeCompletionInfo } from './IEncodeCompletionSink.js';
import { UploadedVideoRegistrationPort } from './IUploadedVideoRegistration.js';

/**
 * 予約管理（`ReservationManageModel`）の操作をIPC越しに呼び出すための窓口。
 * 各methodは実際には`IPCClient`実装内で子process（operator process）へメッセージを送り、
 * その応答を待ってPromiseを解決する薄いproxyであり、ここでの引数・戻り値は
 * `ReservationManageModel`側の対応するmethodへそのまま渡る/返る。
 */
export interface IPCReservationManageModel {
    /** 現在の予約更新処理の進行状況を取得する。 */
    getBroadcastStatus(): Promise<apid.BroadcastStatus>;
    /** 手動予約を追加する。 */
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    /** 指定した予約1件のみを最新の番組情報で再計算する。 */
    update(reserveId: apid.ReserveId): Promise<void>;
    /** 指定したルールに紐づく予約全体を再計算する。 */
    updateRule(ruleId: apid.RuleId): Promise<void>;
    /**
     * 全予約を最新の番組情報で再計算する。
     * @param isUntilComplete `true`の場合、operator process側での再計算が完了するまでこのPromiseを待たせる。
     *                          `false`の場合は再計算の開始だけ行わせ、完了を待たずに解決する
     *                          （IPCServer側の分岐で挙動が切り替わる。名前に反して「初回か」の意味ではない）。
     */
    updateAll(isUntilComplete: boolean): Promise<void>;
    /** 指定した予約を取り消す（手動予約の削除、ルール予約はskip状態にする等、実際の扱いは実装側に委ねる）。 */
    cancel(reserveId: apid.ReserveId): Promise<void>;
    /** 指定した予約のskip（対象から除外）指定を解除する。 */
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    /** 指定した予約の重複（overlap）指定を解除する。 */
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    /** 手動予約の内容を編集する。 */
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    /** 不要になった予約情報（対象番組が既に終了した手動予約など）を整理する。 */
    clean(): Promise<void>;
}

/**
 * 録画済み情報管理（`RecordedManageModel`）の操作をIPC越しに呼び出すための窓口。
 * `IPCReservationManageModel`と同様、実体はoperator process側の対応するmodelへの薄いproxy。
 */
export interface IPCRecordedManageModel {
    /** 録画情報を削除する。関連する録画ファイル・サムネイルも合わせて削除される。 */
    delete(recordedId: apid.RecordedId): Promise<void>;
    /** 指定した録画ファイルの実ファイルサイズを取得し直し、DB上の値を更新する。 */
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    /** 既存の録画情報に、別encodeで生成した録画ファイルを追加登録する。 */
    addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId>;
    /** 外部からアップロードされた動画ファイルを録画ファイルとして登録する。 */
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void>;
    /** 予約に基づかない録画情報（アップロード等の受け皿）を新規作成する。 */
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    /**
     * 録画ファイルを削除する。
     * @param videoFileId 削除対象の録画ファイルID。
     * @param isIgnoreProtection `true`を指定すると、保護（protect）指定を無視して削除する。
     */
    deleteVideoFile(videoFileId: apid.VideoFileId, isIgnoreProtection?: boolean): Promise<void>;
    /** 録画情報の保護（自動削除対象から外す）状態を切り替える。 */
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    /** 実体ファイルが存在しない録画ファイル情報など、不整合になった録画ファイルをDBから整理する。 */
    videoFileCleanup(): Promise<void>;
    /** 実体ファイルが存在しないドロップログ情報をDBから整理する。 */
    dropLogFileCleanup(): Promise<void>;
}

/** 録画タグ管理の操作をIPC越しに呼び出すための窓口。実体はoperator process側の対応するmodelへの薄いproxy。 */
export interface IPCRecordedTagManageModel {
    /** タグを新規作成する。 */
    create(name: string, color: string): Promise<apid.RecordedTagId>;
    /** タグの名前・色を更新する。 */
    update(tagId: apid.RecordedTagId, name: string, color: string): Promise<void>;
    /** タグと録画情報を関連付ける。 */
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    /** タグを削除する（関連付けられた録画情報からも外れる）。 */
    delete(tagId: apid.RecordedTagId): Promise<void>;
    /** タグと録画情報の関連付けのみを解除する（タグ自体は残る）。 */
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
}

/** 録画実行管理（`RecordingManageModel`）の操作をIPC越しに呼び出すための窓口。 */
export interface IPCRecordingManageModel {
    /**
     * 実行中の録画スケジュール用タイマーを設定し直す。応答を待たない fire-and-forget 呼び出し
     * （戻り値が`void`で`Promise`ではない点が他のIPC facadeと異なる）。
     */
    resetTimer(): void;
}

/** ルール管理の操作をIPC越しに呼び出すための窓口。実体はoperator process側の対応するmodelへの薄いproxy。 */
export interface IPCRuleManageModel {
    /** ルールを新規作成する。 */
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    /** 既存ルールの内容を更新する。 */
    update(rule: apid.Rule): Promise<void>;
    /** ルールを有効化する。 */
    enable(ruleId: apid.RuleId): Promise<void>;
    /** ルールを無効化する（紐づく予約はそのまま残る想定）。 */
    disable(ruleId: apid.RuleId): Promise<void>;
    /** ルールを1件削除する。 */
    delete(ruleId: apid.RuleId): Promise<void>;
}

/** サムネイル管理の操作をIPC越しに呼び出すための窓口。実体はoperator process側の対応するmodelへの薄いproxy。 */
export interface IPCThumbnailManageModel {
    /** 全録画のサムネイルを再生成する。 */
    regenerate(): Promise<void>;
    /** 対応する録画ファイルが存在しないサムネイルファイルを整理する。 */
    fileCleanup(): Promise<void>;
    /** 指定した録画ファイルのサムネイルを生成する。 */
    add(videoFileId: apid.VideoFileId): Promise<void>;
    /** サムネイルを削除する。 */
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
}

/** encode処理の完了通知をoperator process側からIPC越しに受け取るための窓口。 */
export interface IPCOperatorEncodeEvent {
    /** encode完了を通知する。呼び出し元（encode process）からのIPC受信をこのmethodへ橋渡しする。 */
    emitFinishEncode(info: EncodeCompletionInfo): Promise<void>;
}

/**
 * web/service process側からoperator process上の各manage modelをIPC経由で操作するための集約窓口。
 * 各propertyは対応するmanage modelの操作をまとめたfacadeであり、DIで解決した1つの`IPCClient`
 * インスタンスがこれら全てのpropertyを構築して保持する。
 */
export default interface IIPCClient {
    reserveation: IPCReservationManageModel;
    recorded: IPCRecordedManageModel;
    recordedTag: IPCRecordedTagManageModel;
    recording: IPCRecordingManageModel;
    rule: IPCRuleManageModel;
    thumbnail: IPCThumbnailManageModel;
    encodeEvent: IPCOperatorEncodeEvent;
    uploadedVideoRegistrationPort: UploadedVideoRegistrationPort;
}
