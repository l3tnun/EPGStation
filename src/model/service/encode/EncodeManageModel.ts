import * as path from 'path';
import * as events from 'events';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { inject, injectable, unmanaged } from 'inversify';
// lodash 本体は UMD で、名前付き export を静的に読み取れない。使う関数を直接読む。
import cloneDeep from 'lodash/cloneDeep.js';
import type * as apid from '../../../../api.js';
import IEncodeEvent, { FinishEncodeInfo } from '../../event/IEncodeEvent.js';
import IConfiguration from '../../IConfiguration.js';
import IExecutionManagementModel, { type ExecutionId } from '../../IExecutionManagementModel.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IEncodeManageModel, { EncodeInfoItem, EncodeQueueInfo, EncodeRecordedIdIndex } from './IEncodeManageModel.js';
import { EncodingRecordedUseSnapshot } from './IEncodingRecordedUseSnapshotProvider.js';
import IRecordedResourceUsePort from './IRecordedResourceUsePort.js';
import { EncodeOption, EncoderModelProvider, IEncoderModel } from './IEncoderModel.js';
import IEncodeFinishModel from './IEncodeFinishModel.js';
import IEncodeQueueStorePort from './IEncodeQueueStorePort.js';
import type { EncodeQueueRecord } from '../../operator/encode/IEncodeQueueStore.js';
import type IRecordedDB from '../../db/IRecordedDB.js';
import type IVideoUtil from '../../api/video/IVideoUtil.js';

/**
 * 起動時の復元（`restore`）で使う読取とファイル操作。録画済み番組と録画ファイルの読取、録画ファイルの full path、
 * 親保存先の path、同じ実体のファイルかの判定、および出力途中のファイルの削除を行う。
 */
export interface EncodeRestoreDependencies {
    recordedDB: Pick<IRecordedDB, 'findId'>;
    videoUtil: Pick<IVideoUtil, 'getFullFilePathFromVideoFile' | 'getParentDirPath'>;
    /** 二つの path が同じ実体（device と inode）のファイルを指すか。どちらかが存在しなければ false */
    isSameFile(a: string, b: string): Promise<boolean>;
    /** ファイルを削除する */
    removeFile(filePath: string): Promise<void>;
}

/** 1件のエンコード（`IEncoderModel`）が録画ファイルの使用権を借りている間の状態。 */
interface RecordedUseLease {
    port: IRecordedResourceUsePort;
    token: object;
    /** `release` 呼び出しを1回だけにするためのキャッシュ。多重解放要求は同じ Promise へ合流する。 */
    releasePromise?: Promise<void>;
    /** `onFinish` の多重発火を防ぐためのキャッシュ。設定済みなら以後の `onFinish` は無視する。 */
    terminalPromise?: Promise<void>;
}

/** 待機中のエンコードを開始しない時間帯。0 時からの経過分で、`start` 以上 `end` 未満を表す
 *  （`start` 0〜1,439、`end` 0〜1,440。`start > end` は日付を跨ぐ）。 */
interface EncodeSuspendTime {
    start: number;
    end: number;
}

/** `IRecordedResourceUsePort` 未注入時に使う no-op 実装。録画ファイルの使用権管理
 *  （録画中ファイルの排他等）が導入される前の挙動（常に許可・何もしない解放）を再現する。 */
const legacyRecordedResourceUsePort: IRecordedResourceUsePort = {
    acquire: async () => ({ token: {} }),
    release: async () => undefined,
};

/**
 * `IEncodeManageModel` の実装。エンコード要求を `waitQueue` に積み、`IExecutionManagementModel`
 * の実行権で排他制御しながら `concurrentEncodeNum` 件まで同時に `runningQueue` へ昇格させる
 * queue 管理者。エンコード対象の録画ファイルは `IRecordedResourceUsePort` 経由で使用権を
 * 借りたうえで処理し、キャンセル・異常終了・正常終了のいずれの経路でも必ず解放する。
 */
@injectable()
class EncodeManageModel implements IEncodeManageModel {
    private log: ILogger;
    private executeManagementModel: IExecutionManagementModel;
    private encoderModelProvider: EncoderModelProvider;
    private encodeEvent: IEncodeEvent;
    /** 同時に実行できるエンコード数の上限。config.yml の `concurrentEncodeNum` から
     *  constructor で一度だけ設定される。 */
    private concurrentEncodeNum: number;
    /** 受け付けられる queue（`admissionReservations` + `waitQueue`）の総数上限。 */
    private encodeQueueLimit: number;
    /** 待機中のエンコードを開始しない時間帯。config.yml の `encodeSuspendTimes` を constructor で
     *  一度だけ検証して経過分へ変換する。省略時は空配列（停止時間帯なし）。 */
    private encodeSuspendTimes: EncodeSuspendTime[];
    /** 停止時間帯の終了時に待機列を再確認する timer。同時に一つだけ持つ。 */
    private suspendResumeTimer: ReturnType<typeof setTimeout> | null = null;
    /** `push` が受理判定から `waitQueue` への追加までの間、queue 上限の空き枠を
     *  先取りしておくための予約数。`waitQueue.length` に含まれない分をここで数えることで、
     *  非同期処理中の要求が上限判定をすり抜けて二重に受理されるのを防ぐ。 */
    private admissionReservations: number = 0;
    /** 実行権取得待ち・空き枠待ちのエンコード一覧（先頭が最も古い）。 */
    private waitQueue: IEncoderModel[] = [];
    /** 現在プロセスを起動して実行中のエンコード一覧。 */
    private runningQueue: IEncoderModel[] = [];
    /** 依頼の記録（管理側の依頼記録窓口）への操作。識別番号もここで割り当てられる。未注入なら記録せず、
     *  識別番号を `processLocalNextEncodeId` から順に割り当てる */
    private encodeQueueStorePort: IEncodeQueueStorePort | null;
    /** 記録 port が未注入のときに次に割り当てる識別番号 */
    private processLocalNextEncodeId: number = 1;
    /** 起動時の復元で使う読取とファイル操作。未注入なら記録の判定を省き、そのまま戻す。 */
    private restoreDependencies: EncodeRestoreDependencies | null;
    /** 中断された変換の出力途中のファイルを復元時に削除するか（`encodeRemoveInterruptedOutput`、省略時 true） */
    private removeInterruptedOutput: boolean;
    /** `restore` を一度だけ始めるための Promise */
    private restoreStarted: Promise<void> | null = null;
    /** 復元の間だけ設定され、受付・取消はこれの完了を待つ */
    private restoring: Promise<void> | null = null;
    /** 起動時の記録の一覧に含まれていた識別番号。識別番号付きの受け渡しの重複除去に使う */
    private listedEncodeIds = new Set<apid.EncodeId>();
    /** 識別番号付きの受け渡しを受付中の識別番号。復元が同じ識別番号を二重に戻さないために使う */
    private admittingEncodeIds = new Set<apid.EncodeId>();
    /** 一覧の取得に失敗したときのやり直しの timer */
    private restoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
    /** 録画ファイルの使用権取得/解放の委譲先。DI で注入されなければ
     *  `legacyRecordedResourceUsePort`（no-op）を使う。 */
    private recordedResourceUsePort: IRecordedResourceUsePort;
    /** 各エンコードが借りている録画ファイル使用権のリース情報。`IEncoderModel` インスタンスを
     *  key にする（queue から取り除かれ参照が無くなれば自動的に消える）。 */
    private recordedUseLeases: WeakMap<IEncoderModel, RecordedUseLease> = new WeakMap();
    /** エンコード正常終了時の後処理（ファイル確定登録等）の委譲先。未設定（`null`）の間は
     *  `IEncodeEvent.emitFinishEncode` の通知のみで済ませる。`setEncodeFinishModel` で
     *  後から注入される（循環依存回避のための遅延注入）。 */
    private encodeFinishModel: IEncodeFinishModel | null;

    /** `checkQueue` の呼び出しをまとめるための内部専用 event。 */
    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('EncoderModelProvider') encoderModelProvider: EncoderModelProvider,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
        @unmanaged() recordedResourceUsePort?: IRecordedResourceUsePort,
        @unmanaged() encodeFinishModel?: IEncodeFinishModel,
        @unmanaged() encodeQueueStorePort?: IEncodeQueueStorePort,
        @unmanaged() restoreDependencies?: EncodeRestoreDependencies,
    ) {
        this.log = logger.getLogger();
        this.executeManagementModel = executeManagementModel;
        const config = configure.getConfig();
        this.concurrentEncodeNum = config.concurrentEncodeNum;
        const encodeQueueLimit = Object.prototype.hasOwnProperty.call(config, 'encodeQueueLimit')
            ? config.encodeQueueLimit
            : EncodeManageModel.DEFAULT_QUEUE_LIMIT;
        if (Number.isSafeInteger(encodeQueueLimit) === false || encodeQueueLimit < 1) {
            throw new Error('InvalidEncodeQueueLimit');
        }
        this.encodeQueueLimit = encodeQueueLimit;
        this.encodeSuspendTimes = Object.prototype.hasOwnProperty.call(config, 'encodeSuspendTimes')
            ? EncodeManageModel.parseSuspendTimes(config.encodeSuspendTimes)
            : [];
        this.encoderModelProvider = encoderModelProvider;
        this.encodeEvent = encodeEvent;
        this.recordedResourceUsePort = recordedResourceUsePort ?? legacyRecordedResourceUsePort;
        this.encodeFinishModel = encodeFinishModel ?? null;
        this.encodeQueueStorePort = encodeQueueStorePort ?? null;
        this.restoreDependencies = restoreDependencies ?? null;
        this.removeInterruptedOutput = config.encodeRemoveInterruptedOutput !== false;

        this.listener.on(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT, this.requestCheckQueue.bind(this));
    }

    /**
     * エンコード情報を queue に積む
     * @param addOption: apid.AddEncodeProgramOption
     * @return apid.EncodeId
     */
    public async push(addOption: apid.AddEncodeProgramOption): Promise<apid.EncodeId> {
        // 復元の間だけ待つ。復元していないときは待たず、受付上限の予約を同じ同期処理の中で行う
        if (this.restoring !== null) {
            await this.restoring;
        }

        return this.admit(addOption, null);
    }

    public async pushPersisted(encodeId: apid.EncodeId, addOption: apid.AddEncodeProgramOption): Promise<void> {
        if (this.restoring !== null) {
            await this.restoring;
        }
        if (this.isEncodeIdInUse(encodeId) === true || this.listedEncodeIds.has(encodeId) === true) {
            return;
        }

        this.admittingEncodeIds.add(encodeId);
        try {
            await this.admit(addOption, encodeId);
        } catch (err: unknown) {
            this.log.encode.error(`recorded encode request is rejected and its record is removed: ${encodeId}`);
            this.log.encode.error(err);
            await this.removeRecord(encodeId);
        } finally {
            this.admittingEncodeIds.delete(encodeId);
        }
    }

    /**
     * 受付の本体。`persistedEncodeId` が null なら依頼記録窓口に記録して識別番号を受け取り、そうでなければ記録済みの
     * 識別番号を使う
     * @param addOption: 依頼内容
     * @param persistedEncodeId: 記録済みの識別番号または null
     * @return 識別番号
     */
    private async admit(
        addOption: apid.AddEncodeProgramOption,
        persistedEncodeId: apid.EncodeId | null,
    ): Promise<apid.EncodeId> {
        if (this.concurrentEncodeNum <= 0) {
            throw new Error('ConcurrentEncodeNumIsZero');
        }

        const addOptionSnapshot = cloneDeep(addOption) as apid.AddEncodeProgramOption;
        const recordedResourceUsePort = this.recordedResourceUsePort;

        if (this.admissionReservations + this.waitQueue.length >= this.encodeQueueLimit) {
            throw new Error('EncodeQueueIsFull');
        }
        this.admissionReservations++;

        let exeId: ExecutionId | undefined;
        let encoder: IEncoderModel | undefined;
        let option: EncodeOption;
        let reservationHeld = true;
        let recordedEncodeId: apid.EncodeId | undefined;
        let recordedUseLease: RecordedUseLease | undefined;
        try {
            // 実行権取得
            exeId = await this.executeManagementModel.getExecution(EncodeManageModel.ADD_ENCODE_PRIPORITY);

            const acquired = await recordedResourceUsePort.acquire(addOptionSnapshot.recordedId, 'encoding');
            if (
                typeof acquired !== 'object' ||
                acquired === null ||
                typeof acquired.token !== 'object' ||
                acquired.token === null
            ) {
                throw new Error('InvalidRecordedResourceUseLease');
            }
            recordedUseLease = { port: recordedResourceUsePort, token: acquired.token };

            // 依頼を記録して識別番号を受け取る
            const encodeId = persistedEncodeId === null ? await this.addRecord(addOptionSnapshot) : persistedEncodeId;
            if (persistedEncodeId === null) {
                recordedEncodeId = encodeId;
            }

            // encoder を生成する
            encoder = await this.encoderModelProvider();
            option = this.createEncodeOption(addOptionSnapshot, encodeId);
            encoder.setOption(option);
            this.recordedUseLeases.set(encoder, recordedUseLease);

            // queue に積む
            this.waitQueue.push(encoder);
            this.log.encode.info(`add new encode: ${option.encodeId}`);

            // イベント発行
            this.encodeEvent.emitAddEncode(option.encodeId);

            this.admissionReservations--;
            reservationHeld = false;
        } catch (err: any) {
            this.waitQueue = this.waitQueue.filter(item => item !== encoder);
            if (typeof recordedEncodeId !== 'undefined') {
                await this.removeRecord(recordedEncodeId);
            }
            if (typeof recordedUseLease !== 'undefined') {
                await this.releaseRecordedUse(recordedUseLease);
            }
            throw err;
        } finally {
            if (typeof exeId !== 'undefined') {
                this.executeManagementModel.unLockExecution(exeId);
            }
            if (reservationHeld === true) {
                this.admissionReservations--;
            }
        }

        this.emitNeedsCheckQueue();

        return option.encodeId;
    }

    /**
     * 依頼記録窓口に依頼を記録する。応答を得られなかった場合は、その要求の記録の取消しを依頼してから失敗を返す
     * @param addOption: 依頼内容
     * @return 割り当てられた識別番号
     */
    private async addRecord(addOption: apid.AddEncodeProgramOption): Promise<apid.EncodeId> {
        const encodeQueueStorePort = this.encodeQueueStorePort;
        if (encodeQueueStorePort === null) {
            return this.processLocalNextEncodeId++;
        }

        const requestToken = randomUUID();
        try {
            return await encodeQueueStorePort.add(addOption, requestToken);
        } catch (err: unknown) {
            this.log.encode.error('failed to record an encode request');
            this.log.encode.error(err);
            void encodeQueueStorePort.abandon(requestToken).catch((abandonError: unknown) => {
                this.log.encode.error('failed to abandon an encode request record');
                this.log.encode.error(abandonError);
            });
            throw err;
        }
    }

    /**
     * 依頼の記録を削除する。失敗はログへ記録して続ける
     * @param encodeId: 識別番号
     */
    private async removeRecord(encodeId: apid.EncodeId): Promise<void> {
        if (this.encodeQueueStorePort === null) {
            return;
        }

        try {
            await this.encodeQueueStorePort.remove(encodeId);
        } catch (err: unknown) {
            this.log.encode.error(`failed to remove the encode request record: ${encodeId}`);
            this.log.encode.error(err);
        }
    }

    /**
     * 同じ識別番号のジョブが待機列・実行中一覧にあるか、受付中か
     * @param encodeId: 識別番号
     */
    private isEncodeIdInUse(encodeId: apid.EncodeId): boolean {
        return this.hasQueuedEncodeId(encodeId) === true || this.admittingEncodeIds.has(encodeId) === true;
    }

    /**
     * 同じ識別番号のジョブが待機列または実行中一覧にあるか
     * @param encodeId: 識別番号
     */
    private hasQueuedEncodeId(encodeId: apid.EncodeId): boolean {
        return [...this.runningQueue, ...this.waitQueue].some(item => item.getEncodeId() === encodeId);
    }

    public restore(): Promise<void> {
        if (this.restoreStarted === null) {
            this.restoreStarted = this.runRestoration();
        }

        return this.restoreStarted;
    }

    /**
     * 記録の一覧を取得して待機列へ戻す。一覧の取得に失敗したら、受付の待ちを解いて一定時間後にやり直す。
     * やり直しはこの復元が終わってから timer で始まるので、終わった時点の `restoring` は必ずこの復元
     */
    private runRestoration(): Promise<void> {
        const restoring = this.restoreRecords().finally(() => {
            this.restoring = null;
        });
        this.restoring = restoring;

        return restoring;
    }

    private async restoreRecords(): Promise<void> {
        if (this.encodeQueueStorePort === null) {
            return;
        }

        let records: EncodeQueueRecord[];
        try {
            records = await this.encodeQueueStorePort.list();
        } catch (err: unknown) {
            this.log.encode.error('failed to list encode request records; retry later');
            this.log.encode.error(err);
            this.restoreRetryTimer = setTimeout(() => {
                this.restoreRetryTimer = null;
                void this.runRestoration();
            }, EncodeManageModel.RESTORE_RETRY_DELAY_MS);
            this.restoreRetryTimer.unref();

            return;
        }

        for (const record of records) {
            this.listedEncodeIds.add(record.id);
        }
        for (const record of records) {
            if (this.isEncodeIdInUse(record.id) === true) {
                continue;
            }

            await this.restoreRecord(record);
        }

        const checkCount = Math.min(this.concurrentEncodeNum - this.runningQueue.length, this.waitQueue.length);
        for (let i = 0; i < checkCount; i++) {
            this.emitNeedsCheckQueue();
        }
    }

    /**
     * 記録を一件判定し、戻せるなら待機列の末尾へ追加する
     * @param record: 記録
     */
    private async restoreRecord(record: EncodeQueueRecord): Promise<void> {
        // 同じ識別番号の重複は、呼出し元（restoreRecords）が判定済み
        const dependencies = this.restoreDependencies;
        if (dependencies !== null) {
            const isRestorable = await this.judgeRestorableRecord(record, dependencies);
            if (isRestorable === false) {
                return;
            }
        }

        let recordedUseLease: RecordedUseLease;
        try {
            const acquired = await this.recordedResourceUsePort.acquire(record.option.recordedId, 'encoding');
            if (
                typeof acquired !== 'object' ||
                acquired === null ||
                typeof acquired.token !== 'object' ||
                acquired.token === null
            ) {
                throw new Error('InvalidRecordedResourceUseLease');
            }
            recordedUseLease = { port: this.recordedResourceUsePort, token: acquired.token };
        } catch (err: unknown) {
            this.log.encode.error(
                `encode request record is dropped because the recorded file is unavailable: ${record.id}`,
            );
            this.log.encode.error(err);
            await this.removeRecord(record.id);

            return;
        }

        try {
            const encoder = await this.encoderModelProvider();
            encoder.setOption(this.createEncodeOption(record.option, record.id));
            this.recordedUseLeases.set(encoder, recordedUseLease);
            this.waitQueue.push(encoder);
            this.log.encode.info(`restore encode: ${record.id}`);
        } catch (err: unknown) {
            this.log.encode.error(`failed to restore an encode request: ${record.id}`);
            this.log.encode.error(err);
            await this.releaseRecordedUse(recordedUseLease);
        }
    }

    /**
     * 記録の対象の有無と出力先を判定する。戻さない記録は削除し（読取の失敗は残す）、出力途中のファイルは設定に従い
     * 削除する
     * @param record: 記録
     * @param dependencies: 読取とファイル操作
     * @return 待機列へ戻すなら true
     */
    private async judgeRestorableRecord(
        record: EncodeQueueRecord,
        dependencies: EncodeRestoreDependencies,
    ): Promise<boolean> {
        let recorded: Awaited<ReturnType<IRecordedDB['findId']>>;
        try {
            recorded = await dependencies.recordedDB.findId(record.option.recordedId);
        } catch (err: unknown) {
            this.log.encode.error(`failed to read the recorded program of an encode request record: ${record.id}`);
            this.log.encode.error(err);

            return false;
        }

        const videoFiles = recorded?.videoFiles ?? [];
        if (recorded === null || videoFiles.some(file => file.id === record.option.sourceVideoFileId) === false) {
            this.log.encode.error(
                `encode request record is dropped because the recorded program or the source file is missing: ${record.id}`,
            );
            await this.removeRecord(record.id);

            return false;
        }

        if (record.outputPath === null) {
            return true;
        }

        for (const file of videoFiles) {
            const registeredPath = dependencies.videoUtil.getFullFilePathFromVideoFile(file);
            if (registeredPath === null) {
                continue;
            }
            if (
                path.resolve(registeredPath) === path.resolve(record.outputPath) ||
                (await dependencies.isSameFile(registeredPath, record.outputPath)) === true
            ) {
                this.log.encode.info(`encode request record is already converted: ${record.id}`);
                await this.removeRecord(record.id);

                return false;
            }
        }

        if (this.removeInterruptedOutput === true) {
            const parentDirPath = dependencies.videoUtil.getParentDirPath(record.option.parentDir);
            const relative =
                parentDirPath === null
                    ? null
                    : path.relative(path.resolve(parentDirPath), path.resolve(record.outputPath));
            if (
                relative === null ||
                relative === '' ||
                relative.startsWith('..') === true ||
                path.isAbsolute(relative) === true
            ) {
                this.log.encode.warn(
                    `interrupted encode output is kept because it is outside the parent directory: ${record.id}`,
                );
            } else {
                try {
                    this.log.encode.info(`delete interrupted encode output: ${record.outputPath}`);
                    await dependencies.removeFile(record.outputPath);
                } catch (err: unknown) {
                    this.log.encode.error(`failed to delete interrupted encode output: ${record.outputPath}`);
                    this.log.encode.error(err);
                }
            }
        }

        return true;
    }

    /**
     * エンコードオプションを生成する
     * @param baseOption: apid.AddEncodeProgramOption
     * @param encodeId: 識別番号
     * @returns EncodeOption
     */
    private createEncodeOption(baseOption: apid.AddEncodeProgramOption, encodeId: apid.EncodeId): EncodeOption {
        // encoder のオプションを生成
        const encodeOption: EncodeOption = cloneDeep(baseOption) as any;
        encodeOption.encodeId = encodeId;

        return encodeOption;
    }

    /**
     * queue の状態をチェックする必要がある場合に呼ぶ
     */
    private emitNeedsCheckQueue(): void {
        this.listener.emit(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT);
    }

    /**
     * queue をチェックする
     * @return Promise<void>
     */
    private async checkQueue(): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(
            EncodeManageModel.CREATE_ENCODING_PROCESS_PRIPORITY,
        );

        // runningQueue がロック中 or 同時エンコード最大数に達している or waitQueue が空の場合はスルー
        if (this.runningQueue.length >= this.concurrentEncodeNum || this.waitQueue.length === 0) {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);

            return;
        }

        // waitQueue から取り出す
        const encoder = this.waitQueue.shift();
        if (typeof encoder === 'undefined') {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);

            return;
        }

        // encodeOption が無い場合は何もしない
        const encodeOption = encoder.getEncodeOption();
        if (encodeOption === null) {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);
            this.log.encode.warn('encodeOption is null'); // encoder 生成時にセットされているはずなので警告を出す
            await this.releaseRecordedUseForEncoder(encoder);
            this.emitNeedsCheckQueue();

            return;
        }

        // runningQueue に積む
        this.runningQueue.push(encoder);

        // エンコード終了時の処理をセット
        encoder.setOnFinish((isError, outputFilePath) => {
            this.onFinish(encoder, isError, outputFilePath, encodeOption);
        });

        // エンコードプロセス開始
        let needsFinalize = false;
        try {
            await encoder.start();
        } catch (err: any) {
            this.log.encode.error(`create encode process error: ${encoder.getEncodeId()}`);
            this.log.encode.error(err);

            needsFinalize = true;

            // エラー通知
            this.encodeEvent.emitErrorEncode();
        }

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        if (needsFinalize === true) {
            try {
                await this.finalize(encodeOption.encodeId, false);
            } finally {
                await this.releaseRecordedUseForEncoder(encoder);
                this.emitNeedsCheckQueue();
            }
        }
    }

    /**
     * 待機列確認の要求を受ける。停止時間帯の間は、空き枠や待機依頼の有無にかかわらず確認せず
     * (実行権を待つ間に空き枠や待機依頼ができても開始しないため)、待機依頼があれば時間帯の終了時に
     * 再確認する timer を設定する
     * @return Promise<void>
     */
    private requestCheckQueue(): Promise<void> {
        const now = new Date();
        const suspendRemainingMinutes = this.getSuspendRemainingMinutes(now);
        if (suspendRemainingMinutes === null) {
            return this.checkQueue();
        }

        if (this.waitQueue.length > 0) {
            this.scheduleSuspendResume(now, suspendRemainingMinutes);
        }

        return Promise.resolve();
    }

    /**
     * 現在時刻を含む停止時間帯のうち、最も早く終わるものの終了までの分数を返す
     * @param now: 現在時刻 (ローカル時刻の時・分で判定する)
     * @return number | null 停止時間帯に含まれなければ null
     */
    private getSuspendRemainingMinutes(now: Date): number | null {
        const current = now.getHours() * 60 + now.getMinutes();
        let remaining: number | null = null;
        for (const range of this.encodeSuspendTimes) {
            const isInRange =
                range.start < range.end
                    ? range.start <= current && current < range.end
                    : current >= range.start || current < range.end;
            if (isInRange === false) {
                continue;
            }

            // 日付を跨ぐ時間帯で終了が翌日側にある場合は 1 日分を足す
            const minutes = range.end > current ? range.end - current : range.end + 24 * 60 - current;
            remaining = remaining === null ? minutes : Math.min(remaining, minutes);
        }

        return remaining;
    }

    /**
     * 停止時間帯の終了時に待機列を再確認する timer を設定する。既に設定済みなら何もしない。
     * サマータイムの切替えや時刻の変更でローカル時刻が実時間と異なる幅で進んでも 1 分以内に判定し直すため、
     * delay は SUSPEND_RECHECK_MAX_DELAY_MS を上限とする
     * @param now: 停止時間帯と判定した時刻
     * @param remainingMinutes: 停止時間帯の終了までの分数
     */
    private scheduleSuspendResume(now: Date, remainingMinutes: number): void {
        if (this.suspendResumeTimer !== null) {
            return;
        }

        const delay = Math.min(
            remainingMinutes * 60 * 1000 - (now.getSeconds() * 1000 + now.getMilliseconds()),
            EncodeManageModel.SUSPEND_RECHECK_MAX_DELAY_MS,
        );
        this.suspendResumeTimer = setTimeout(() => {
            this.suspendResumeTimer = null;

            // 待機列確認は一回につき一件だけ開始するため、空き枠の数だけ確認を要求する
            const checkCount = Math.min(this.concurrentEncodeNum - this.runningQueue.length, this.waitQueue.length);
            for (let i = 0; i < checkCount; i++) {
                this.emitNeedsCheckQueue();
            }
        }, delay);
        this.suspendResumeTimer.unref();
    }

    /**
     * エンコード終了処理
     * @param isError: 異常終了か
     * @param outputFilePath: エンコードファイルパス
     * @param encodeOption: エンコードオプション
     */
    public setEncodeFinishModel(model: IEncodeFinishModel): void {
        this.encodeFinishModel = model;
    }

    private onFinish(
        encoder: IEncoderModel,
        isError: boolean,
        outputFilePath: string | null,
        encodeOption: EncodeOption,
    ): void {
        const lease = this.recordedUseLeases.get(encoder);
        if (typeof lease !== 'undefined' && typeof lease.terminalPromise !== 'undefined') {
            return;
        }

        const terminalPromise = this.finish(encoder, isError, outputFilePath, encodeOption);
        if (typeof lease !== 'undefined') {
            lease.terminalPromise = terminalPromise;
        }

        void terminalPromise.catch(err => this.logResultSettlementFailure(err));
    }

    private async finish(
        encoder: IEncoderModel,
        isError: boolean,
        outputFilePath: string | null,
        encodeOption: EncodeOption,
    ): Promise<void> {
        if (isError) {
            // エラー通知
            this.encodeEvent.emitErrorEncode();
            try {
                await this.finalize(encodeOption.encodeId);
            } finally {
                await this.releaseRecordedUseForEncoder(encoder);
            }

            return;
        }

        const settlement = this.finishEncode(this.createFinishEncodeInfo(outputFilePath, encodeOption));
        try {
            await this.finalize(encodeOption.encodeId);
        } finally {
            try {
                await settlement;
            } catch (err: unknown) {
                this.logResultSettlementFailure(err);
            } finally {
                await this.releaseRecordedUseForEncoder(encoder);
            }
        }
    }

    private createFinishEncodeInfo(outputFilePath: string | null, encodeOption: EncodeOption): FinishEncodeInfo {
        const fileName = outputFilePath === null ? null : path.basename(outputFilePath);
        if (
            encodeOption.removeOriginal === true &&
            this.hasSamVideoFileIdItem(encodeOption.sourceVideoFileId, encodeOption.encodeId) === true
        ) {
            // queue に削除予定の videofile が存在するので、削除しないように false にする
            encodeOption.removeOriginal = false;
        }

        return {
            recordedId: encodeOption.recordedId,
            videoFileId: encodeOption.sourceVideoFileId,
            parentDirName: encodeOption.parentDir,
            filePath:
                outputFilePath === null || fileName === null
                    ? null
                    : typeof encodeOption.directory === 'undefined'
                      ? fileName
                      : path.join(encodeOption.directory, fileName),
            fullOutputPath: outputFilePath,
            mode: encodeOption.mode,
            removeOriginal: encodeOption.removeOriginal,
        };
    }

    private finishEncode(info: FinishEncodeInfo): Promise<void> {
        const finishModel = this.encodeFinishModel;
        if (finishModel === null) {
            this.encodeEvent.emitFinishEncode(info);
            return Promise.resolve();
        }

        return Promise.resolve().then(() => finishModel.finishEncode(info));
    }

    private logResultSettlementFailure(err: unknown): void {
        try {
            this.log.system.error(err);
        } catch (_logError: unknown) {
            // result settlement failure must not leave an unhandled terminal callback
        }
    }

    /**
     * videoFileId で指定した video file id を持つ queue item が存在するか調べる
     * @param videoFileId: apid.VideoFileId
     * @param excludeEncodeId: apid.EncodeId 除外する encode id
     * @return boolean 存在するなら true を返す
     */
    private hasSamVideoFileIdItem(videoFileId: apid.VideoFileId, excludeEncodeId: apid.EncodeId): boolean {
        const runningItem = this.runningQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof runningItem !== 'undefined') {
            return true;
        }

        const waitItem = this.waitQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof waitItem !== 'undefined') {
            return true;
        }

        return false;
    }

    /**
     * 最終処理
     * @param encodeId: apid.EncodeId
     */
    private async finalize(encodeId: apid.EncodeId, checkNext: boolean = true): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CLEAR_QUEUE_PRIPORITY);

        // runningQueue から encodeId の要素を削除する
        this.runningQueue = this.runningQueue.filter(q => {
            return q.getEncodeId() !== encodeId;
        });

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        if (checkNext === true) {
            process.nextTick(() => {
                this.emitNeedsCheckQueue();
            });
        }
    }

    /**
     * 終わった依頼の記録を削除してから、録画の使用権を解放する。依頼の終わり（正常終了・異常終了・取消・開始失敗・
     * 待機中の取消）は、どれもここを通る
     * @param encoder: IEncoderModel
     */
    private async releaseRecordedUseForEncoder(encoder: IEncoderModel): Promise<void> {
        const encodeId = encoder.getEncodeId();
        if (encodeId !== null) {
            await this.removeRecord(encodeId);
        }

        const lease = this.recordedUseLeases.get(encoder);
        if (typeof lease === 'undefined') {
            return;
        }

        await this.releaseRecordedUse(lease);
    }

    private async releaseRecordedUse(lease: RecordedUseLease): Promise<void> {
        if (typeof lease.releasePromise === 'undefined') {
            lease.releasePromise = Promise.resolve()
                .then(() => lease.port.release(lease.token))
                .catch((err: unknown) => this.logRecordedUseReleaseFailure(err));
        }

        await lease.releasePromise;
    }

    private logRecordedUseReleaseFailure(err: unknown): void {
        try {
            this.log.encode.error('release recorded resource use failed');
            this.log.encode.error(err);
        } catch (_logError: unknown) {
            // release failure must not prevent queue cleanup or cancellation
        }
    }

    /**
     * 指定された encode id を queue から削除する
     * @param encodeId: apid.EncodeId
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        // 復元の間だけ待つ（まだ戻していない識別番号への取消を、戻した後の依頼へ届けるため）
        if (this.restoring !== null) {
            await this.restoring;
        }

        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CANCEL_ENCODE_PRIPORITY);

        this.log.encode.info(`cancel encode: ${encodeId}`);

        // 取消要求を受け付けた時点で通知する
        this.encodeEvent.emitCancelEncode(encodeId);

        try {
            const runningQueueItem = this.getRunnginQueueItem(encodeId);
            if (typeof runningQueueItem !== 'undefined') {
                await runningQueueItem.cancel();
            } else {
                // waitQueue から削除
                const canceledItems = this.waitQueue.filter(q => q.getEncodeId() === encodeId);
                this.waitQueue = this.waitQueue.filter(q => q.getEncodeId() !== encodeId);

                await Promise.all(canceledItems.map(item => this.releaseRecordedUseForEncoder(item)));

                process.nextTick(() => {
                    this.emitNeedsCheckQueue();
                });
            }
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }
    }

    /**
     * 指定した encodeId を runningQueue から取り出す
     * @param encodeId: apid.EncodeId
     * @return IEncoderModel | undefined
     */
    private getRunnginQueueItem(encodeId: apid.EncodeId): IEncoderModel | undefined {
        return this.runningQueue.find(q => {
            return q.getEncodeId() === encodeId;
        });
    }

    /**
     * queu に積まれている要素の recorded id の索引を返す
     */
    public getRecordedIndex(): EncodeRecordedIdIndex {
        const index: EncodeRecordedIdIndex = {};

        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        return index;
    }

    /** 待機中および実行中の録画 ID を、外部状態を変更せずに取得する。 */
    public getQueuedAndRunningRecordedIds(): EncodingRecordedUseSnapshot {
        const recordedIds = new Set<apid.RecordedId>();

        try {
            for (const item of [...this.runningQueue, ...this.waitQueue]) {
                const option = item.getEncodeOption();
                if (option === null) {
                    return { status: 'unknown' };
                }
                recordedIds.add(option.recordedId);
            }
        } catch (_err: unknown) {
            return { status: 'unknown' };
        }

        return {
            status: 'known',
            recordedIds,
        };
    }

    /**
     * 指定した recordedId を持つエンコードをキャンセルする
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void> {
        // 復元の間だけ待つ（まだ戻していない依頼も対象に含めるため）
        if (this.restoring !== null) {
            await this.restoring;
        }

        const encodeIds: apid.EncodeId[] = [];

        // recordedId に該当する encodedId を取り出す
        // wait queue
        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // running queue
        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // 取り出した encodedId を元にキャンセル指示を出す
        let isError = false;
        for (const encodeId of encodeIds) {
            await this.cancel(encodeId).catch(err => {
                isError = true;
                this.log.encode.error(`cancel encode failed: ${encodeId}`);
                this.log.encode.error(err);
            });
        }

        // キャンセルに失敗した場合はエラーを履く
        if (isError !== false) {
            throw new Error('StopEncodeError');
        }
    }

    /**
     * queue に積まれているエンコード情報を返す
     * @return EncodeQueueInfo
     */
    public getEncodeInfo(): EncodeQueueInfo {
        const queueInfo: EncodeQueueInfo = {
            runningQueue: [],
            waitQueue: [],
        };

        // running queue
        for (const i of this.runningQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            const result: EncodeInfoItem = {
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            };

            const progress = i.getProgressInfo();
            if (progress !== null) {
                result.percent = progress.percent;
                result.log = progress.log;
            }

            queueInfo.runningQueue.push(result);
        }

        // wait queue
        for (const i of this.waitQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            queueInfo.waitQueue.push({
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            });
        }

        return queueInfo;
    }
}

namespace EncodeManageModel {
    export const UNLOCK_EVENT = 'unlockEvent';
    export const CANCEL_ENCODE_PRIPORITY = 1;
    export const ADD_ENCODE_PRIPORITY = 2;
    export const CREATE_ENCODING_PROCESS_PRIPORITY = 2;
    export const CLEAR_QUEUE_PRIPORITY = 3;
    export const NEEDS_CHECK_QUEUE_EVENT = 'needsCheckQueue';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
    export const DEFAULT_QUEUE_LIMIT = 1024;
    /** 起動時に記録の一覧を取得できなかったときに、取得し直すまでの時間（ミリ秒） */
    export const RESTORE_RETRY_DELAY_MS = 60 * 1000;

    /**
     * 二つの path が同じ実体（device と inode）のファイルを指すか。どちらかが存在しない、または読めなければ false
     * @param a: path
     * @param b: path
     * @return 同じ実体なら true
     */
    export const isSameFile = async (a: string, b: string): Promise<boolean> => {
        try {
            const [statA, statB] = await Promise.all([fs.promises.stat(a), fs.promises.stat(b)]);

            return statA.dev === statB.dev && statA.ino === statB.ino;
        } catch {
            return false;
        }
    };
    /** 停止時間帯の再開 timer の delay の上限（ミリ秒）。この間隔以内に時間帯を判定し直す。 */
    export const SUSPEND_RECHECK_MAX_DELAY_MS = 60 * 1000;

    /**
     * config.yml の `encodeSuspendTimes` を検証し、0 時からの経過分へ変換する
     * @param value: 設定値
     * @return EncodeSuspendTime[]
     * @throws Error InvalidEncodeSuspendTimes 配列でない、または不正な要素を含む場合
     */
    export const parseSuspendTimes = (value: unknown): EncodeSuspendTime[] => {
        if (Array.isArray(value) === false) {
            throw new Error('InvalidEncodeSuspendTimes');
        }

        return value.map(range => {
            if (typeof range !== 'object' || range === null || Array.isArray(range) === true) {
                throw new Error('InvalidEncodeSuspendTimes');
            }

            const start = parseSuspendMinutes(range.start, 23 * 60 + 59);
            const end = parseSuspendMinutes(range.end, 24 * 60);
            if (start === null || end === null || start === end) {
                throw new Error('InvalidEncodeSuspendTimes');
            }

            return { start, end };
        });
    };

    /**
     * HH:mm 形式の時刻を 0 時からの経過分へ変換する
     * @param value: 時刻
     * @param maximum: 許可する最大の経過分
     * @return number | null 形式外または範囲外なら null
     */
    const parseSuspendMinutes = (value: unknown, maximum: number): number | null => {
        if (typeof value !== 'string') {
            return null;
        }

        const match = /^(\d{2}):(\d{2})$/u.exec(value);
        if (match === null) {
            return null;
        }

        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (minutes > 59 || hours * 60 + minutes > maximum) {
            return null;
        }

        return hours * 60 + minutes;
    };
}

export default EncodeManageModel;
declare const __EPGSTATION_COVERAGE_EXCLUSION_ENCODE_MANAGE_CHECK_QUEUE_UNDEFINED_20260924: unique symbol;
