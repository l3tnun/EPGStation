import * as path from 'path';
import * as events from 'events';
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

/** 1件のエンコード（`IEncoderModel`）が録画ファイルの使用権を借りている間の状態。 */
interface RecordedUseLease {
    port: IRecordedResourceUsePort;
    token: object;
    /** `release` 呼び出しを1回だけにするためのキャッシュ。多重解放要求は同じ Promise へ合流する。 */
    releasePromise?: Promise<void>;
    /** `onFinish` の多重発火を防ぐためのキャッシュ。設定済みなら以後の `onFinish` は無視する。 */
    terminalPromise?: Promise<void>;
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
    /** `push` が受理判定から `waitQueue` への追加までの間、queue 上限の空き枠を
     *  先取りしておくための予約数。`waitQueue.length` に含まれない分をここで数えることで、
     *  非同期処理中の要求が上限判定をすり抜けて二重に受理されるのを防ぐ。 */
    private admissionReservations: number = 0;
    /** 実行権取得待ち・空き枠待ちのエンコード一覧（先頭が最も古い）。 */
    private waitQueue: IEncoderModel[] = [];
    /** 現在プロセスを起動して実行中のエンコード一覧。 */
    private runningQueue: IEncoderModel[] = [];
    /** 次に発行する encodeId の候補。`Number.MAX_SAFE_INTEGER` に達したら 0 へ巻き戻る。 */
    private idCnt: number = 1;
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
        this.encoderModelProvider = encoderModelProvider;
        this.encodeEvent = encodeEvent;
        this.recordedResourceUsePort = recordedResourceUsePort ?? legacyRecordedResourceUsePort;
        this.encodeFinishModel = encodeFinishModel ?? null;

        this.listener.on(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT, this.checkQueue.bind(this));
    }

    /**
     * エンコード情報を queue に積む
     * @param addOption: apid.AddEncodeProgramOption
     * @return apid.EncodeId
     */
    public async push(addOption: apid.AddEncodeProgramOption): Promise<apid.EncodeId> {
        if (this.concurrentEncodeNum <= 0) {
            throw new Error('CncurrentEncodeNumIsZero');
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
        let previousIdCnt: number | undefined;
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
            previousIdCnt = this.idCnt;

            // encoder を生成する
            encoder = await this.encoderModelProvider();
            option = this.createEncodeOption(addOptionSnapshot);
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
            if (typeof previousIdCnt !== 'undefined') {
                this.idCnt = previousIdCnt;
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
     * エンコードオプションを生成する
     * @param baseOption: apid.AddEncodeProgramOption
     * @returns EncodeOption
     */
    private createEncodeOption(baseOption: apid.AddEncodeProgramOption): EncodeOption {
        // encoder のオプションを生成
        const encodeOption: EncodeOption = cloneDeep(baseOption) as any;
        const encodeId = this.idCnt;
        encodeOption.encodeId = encodeId;

        // idCnt をインクリメント
        if (this.idCnt === Number.MAX_SAFE_INTEGER) {
            this.idCnt = 0;
        }
        this.idCnt++;

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

    private async releaseRecordedUseForEncoder(encoder: IEncoderModel): Promise<void> {
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
    export const UNLOCK_TIMEOUT = 1000 * 60;
    export const CANCEL_ENCODE_PRIPORITY = 1;
    export const ADD_ENCODE_PRIPORITY = 2;
    export const CREATE_ENCODING_PROCESS_PRIPORITY = 2;
    export const CLEAR_QUEUE_PRIPORITY = 3;
    export const NEEDS_CHECK_QUEUE_EVENT = 'needsCheckQueue';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
    export const DEFAULT_QUEUE_LIMIT = 1024;
}

export default EncodeManageModel;
declare const __EPGSTATION_COVERAGE_EXCLUSION_ENCODE_MANAGE_CHECK_QUEUE_UNDEFINED_20260924: unique symbol;
