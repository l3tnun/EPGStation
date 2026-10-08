import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import type * as apid from '../../../../api.js';
import Thumbnail from '../../../db/entities/Thumbnail.js';
import VideoFile from '../../../db/entities/VideoFile.js';
import FileUtil from '../../../util/FileUtil.js';
import ProcessUtil from '../../../util/ProcessUtil.js';
import IVideoUtil from '../../api/video/IVideoUtil.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IThumbnailDB from '../../db/IThumbnailDB.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IThumbnailEvent from '../../event/IThumbnailEvent.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import { IPromiseQueue } from '../../IPromiseQueue.js';
import IThumbnailManageModel from './IThumbnailManageModel.js';

/** `prepareVideoFile` 1回分の呼び出しを識別するトークン。`activePreparationRequest` と
 *  参照が一致する呼び出しだけが自分の完了処理を行えるようにする（後発の呼び出しに
 *  上書きされた古い呼び出しの完了処理を無視するため）。 */
interface PreparationRequest {
    readonly deadline: number;
}

/** `prepareVideoFile` が解決する、生成対象の video file 情報一式。`videoFile`/`videoFilePath`
 *  が `null` の場合は DB またはファイルパス解決の時点で見つからなかったことを表す。 */
interface PreparedVideoFile {
    readonly deadline: number;
    readonly videoFile: VideoFile | null;
    readonly videoFilePath: string | null;
}

/** サムネイル1件分の出力先予約。最終的な保存先（`finalPath`）を `wx`（排他生成）で
 *  先に確保して重複ファイル名を避けたうえで、実際の生成は一時ディレクトリ
 *  （`temporaryDirectory`/`temporaryPath`）で行い、成功した場合のみ `publishOutput` で
 *  `finalPath` へコピーする。`activeReservations`（class 側）で存命中のものを追跡する。 */
interface OutputReservation {
    readonly fileName: string;
    readonly finalPath: string;
    readonly requestId: string;
    readonly reservationId: string;
    temporaryDirectory: string | null;
    temporaryPath: string | null;
    /** `publishOutput` で一時ファイルを `finalPath` へコピーし終えたか。 */
    published: boolean;
    /** `cleanupReservation` が実行済みか（多重実行防止）。 */
    released: boolean;
}

/** `awaitChildSettlement` 1回分の生成処理の状態。子プロセスの終了（`childTerminal`）と
 *  後続の非同期処理（DB登録等、`businessComplete`）の両方が揃って初めて `finalize` が
 *  Promise を解決/棄却できる。 */
interface GenerationRequest {
    readonly requestId: string;
    businessComplete: boolean;
    childTerminal: boolean;
    failure: Error | null;
    /** 成功/失敗が一度でも確定したか（`onClose`/`onError`の多重処理防止）。 */
    settled: boolean;
}

/**
 * `IThumbnailManageModel` の実装。動画ファイルから ffmpeg（`config.thumbnailCmd`）で
 * サムネイル画像を生成する。生成要求は `IPromiseQueue` で直列化しつつ、キュー投入前の
 * 待機件数を `pendingThumbnailCount`/`thumbnailMaxPending` で頭打ちにする。出力ファイルは
 * 「最終パスを排他生成で予約 → 一時ディレクトリで生成 → 成功時のみ最終パスへコピー」という
 * 手順で、生成失敗時に不完全なサムネイルファイルが確定パスに残らないようにしている。
 */
@injectable()
export default class ThumbnailManageModel implements IThumbnailManageModel {
    /** `thumbnailMaxPending` が config.yml に設定されていない場合の既定値。 */
    private static readonly DEFAULT_MAX_PENDING = 32;
    /** `prepareVideoFile`（DB検索・ファイルパス解決）に許容する最大待ち時間。 */
    private static readonly PREPARATION_TIMEOUT_MS = 30_000;
    /** `PREPARATION_TIMEOUT_MS` 超過時に使い回す共通の Error インスタンス。 */
    private static readonly PREPARATION_TIMEOUT_ERROR = new Error('ThumbnailPreparationTimeout');
    /** ffmpeg プロセスの生成処理に許容する最大時間（ミリ秒）。 */
    private static processTimeoutMs(): number {
        return 300 * 1_000;
    }

    /** `activeReservations`/`requestSequence`/`reservationSequence` の初期値をまとめて
     *  作る（constructor から呼ぶだけの補助）。 */
    private static createReservationState(): {
        activeReservations: Set<OutputReservation>;
        requestSequence: number;
        reservationSequence: number;
    } {
        return {
            activeReservations: new Set<OutputReservation>(),
            requestSequence: 0,
            reservationSequence: 0,
        };
    }

    private log: ILogger;
    private config: IConfigFile;
    private queue: IPromiseQueue;
    private recordedDB: IRecordedDB;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private thumbnailEvent: IThumbnailEvent;
    private videoUtil: IVideoUtil;
    /** 同時に受け付けられる待機件数の上限。constructor で config.yml の
     *  `thumbnailMaxPending`（未設定なら `DEFAULT_MAX_PENDING`）から一度だけ設定される。 */
    private readonly thumbnailMaxPending: number;
    /** `add` でキューに投入されたが、まだ実際の生成処理（`create`）が開始していない件数。
     *  `add` で加算し、queue の実行開始時（`releasePending`）で減算する。 */
    private pendingThumbnailCount: number = 0;
    /** 現在進行中の `prepareVideoFile` 呼び出しを表すトークン（無ければ `null`）。 */
    private activePreparationRequest: PreparationRequest | null = null;
    /** 現在進行中（生成中またはクリーンアップ待ち）の出力予約の集合。`fileCleanup` が
     *  「まだ使用中で削除してはいけないファイル」を判定するのに使う。 */
    private activeReservations: Set<OutputReservation>;
    /** 次に発行する `requestId` の連番。 */
    private requestSequence: number;
    /** 次に発行する `reservationId` の連番。 */
    private reservationSequence: number;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IPromiseQueue') queue: IPromiseQueue,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IThumbnailEvent') thumbnailEvent: IThumbnailEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.thumbnailMaxPending = this.config.thumbnailMaxPending ?? ThumbnailManageModel.DEFAULT_MAX_PENDING;
        this.queue = queue;
        this.recordedDB = recordedDB;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.thumbnailEvent = thumbnailEvent;
        this.videoUtil = videoUtil;
        const reservationState = ThumbnailManageModel.createReservationState();
        this.activeReservations = reservationState.activeReservations;
        this.requestSequence = reservationState.requestSequence;
        this.reservationSequence = reservationState.reservationSequence;
    }

    /**
     * サムネイル作成 Queue に追加する
     * @param videoFileId: apid.VideoFileId
     */
    public add(videoFileId: apid.VideoFileId): void {
        if (this.pendingThumbnailCount >= this.thumbnailMaxPending) {
            throw new Error('ThumbnailQueueIsFull');
        }
        this.pendingThumbnailCount++;
        let isPending = true;
        const releasePending = (): void => {
            if (isPending === false) {
                return;
            }
            isPending = false;
            this.pendingThumbnailCount--;
        };

        this.log.system.info(`add thumbnail queue: ${videoFileId}`);

        try {
            this.queue.add<void>(() => {
                releasePending();

                return this.create(videoFileId).catch(err => {
                    this.log.system.error(`create thumbnail error: ${videoFileId}`);
                    this.log.system.error(err);
                });
            });
        } catch (err: any) {
            releasePending();
            throw err;
        }
    }

    /**
     * サムネイル生成をして生成したファイルを Thumbnail に登録する
     * @param videoFileId: apid.VideoFileId
     */
    private async create(videoFileId: apid.VideoFileId): Promise<void> {
        const prepared = await this.prepareVideoFile(videoFileId);
        if (performance.now() >= prepared.deadline) {
            throw new Error('ThumbnailPreparationTimeout');
        }
        const { videoFile, videoFilePath } = prepared;
        if (videoFile === null || videoFilePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        // check thumbnail dir
        try {
            await FileUtil.access(this.config.thumbnail, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err: any) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.system.warn(`mkdirp: ${this.config.thumbnail}`);
                await FileUtil.mkdir(this.config.thumbnail);
            } else {
                // アクセス権に Read or Write が無い
                this.log.system.fatal(`thumbnail dir permission error: ${this.config.thumbnail}`);
                this.log.system.fatal(err);
                throw err;
            }
        }

        const requestId = `thumbnail-request-${++this.requestSequence}`;
        const reservation = await this.reserveOutput(videoFile.recordedId, requestId);
        try {
            const cmdStr = this.config.thumbnailCmd.replace(/%FFMPEG%/g, this.config.ffmpeg);
            const cmds = ProcessUtil.parseCmdStr(cmdStr);

            // コマンドの引数準備
            for (let i = 0; i < cmds.args.length; i++) {
                cmds.args[i] = cmds.args[i]
                    .replace(/%INPUT%/, videoFilePath)
                    .replace(/%OUTPUT%/, reservation.temporaryPath as string)
                    .replace(/%THUMBNAIL_POSITION%/, `${this.config.thumbnailPosition.toString(10)}`)
                    .replace(/%THUMBNAIL_SIZE%/, this.config.thumbnailSize);
            }

            await this.runGeneration(videoFileId, videoFile.recordedId, cmds.bin, cmds.args, reservation);
        } catch (err: unknown) {
            await this.cleanupReservation(reservation, false);
            throw err;
        }
    }

    /**
     * DB検索とファイルパス解決を行い、`PREPARATION_TIMEOUT_MS`でタイムアウトさせる。
     * `activePreparationRequest`に自分のトークンを保持し、`settle`時点で他の呼び出しに
     * 上書きされていないか（つまり自分が最新の呼び出しか）を確認してから完了させる。
     * @param videoFileId 対象の video file id
     * @returns 解決した video file 情報（見つからなければ各値が `null`）
     * @throws タイムアウトした場合は `PREPARATION_TIMEOUT_ERROR`
     */
    private prepareVideoFile(videoFileId: apid.VideoFileId): Promise<PreparedVideoFile> {
        const request: PreparationRequest = {
            deadline: performance.now() + ThumbnailManageModel.PREPARATION_TIMEOUT_MS,
        };
        this.activePreparationRequest = request;

        return new Promise<PreparedVideoFile>((resolve, reject) => {
            const settle = (complete: () => void): void => {
                if (this.activePreparationRequest !== request) {
                    return;
                }
                clearTimeout(timer);
                this.activePreparationRequest = null;
                complete();
            };
            const rejectTimeout = (): void => settle(() => reject(ThumbnailManageModel.PREPARATION_TIMEOUT_ERROR));

            const timer = setTimeout(rejectTimeout, ThumbnailManageModel.PREPARATION_TIMEOUT_MS);
            void this.resolveVideoFilePreparation(videoFileId, request).then(
                prepared => settle(() => resolve(prepared)),
                err => settle(() => reject(err)),
            );
        });
    }

    private async resolveVideoFilePreparation(
        videoFileId: apid.VideoFileId,
        request: PreparationRequest,
    ): Promise<PreparedVideoFile> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (performance.now() >= request.deadline) {
            throw ThumbnailManageModel.PREPARATION_TIMEOUT_ERROR;
        }
        const videoFilePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        return { deadline: request.deadline, videoFile, videoFilePath };
    }

    /**
     * `recordedId`を基にしたファイル名で最終出力先を排他生成（`wx`）し、同名衝突時は
     * `(1)`,`(2)`...と連番を付けて再試行する。予約が確定したら、実際の生成先となる
     * 専用の一時ディレクトリも合わせて用意する。
     * @param recordedId 出力ファイル名の基になる録画id
     * @param requestId 呼び出し元（`create`）の要求id
     * @returns 確保した出力予約
     */
    private async reserveOutput(recordedId: apid.RecordedId, requestId: string): Promise<OutputReservation> {
        for (let conflict = 0; ; conflict++) {
            const suffix = conflict === 0 ? '' : `(${conflict})`;
            const fileName = `${recordedId}${suffix}.jpg`;
            const finalPath = path.join(this.config.thumbnail, fileName);

            let fileHandle: fs.promises.FileHandle;
            try {
                fileHandle = await fs.promises.open(finalPath, 'wx');
            } catch (err: any) {
                if (err?.code === 'EEXIST') {
                    continue;
                }
                throw err;
            }

            const reservation: OutputReservation = {
                fileName,
                finalPath,
                requestId,
                reservationId: `thumbnail-reservation-${++this.reservationSequence}`,
                temporaryDirectory: null,
                temporaryPath: null,
                published: false,
                released: false,
            };
            this.activeReservations.add(reservation);
            try {
                await fileHandle.close();
                reservation.temporaryDirectory = await fs.promises.mkdtemp(
                    path.join(this.config.thumbnail, '.thumbnail-'),
                );
                reservation.temporaryPath = path.join(reservation.temporaryDirectory, 'thumbnail.jpg');
            } catch (err: any) {
                this.logReservationFailure('reservation', reservation, err);
                await this.cleanupReservation(reservation, false);
                throw err;
            }
            return reservation;
        }
    }

    /**
     * 一時ファイルを最終出力先へコピーする（多重実行防止のため`published`済みなら何もしない）。
     * @param reservation 対象の出力予約
     */
    private async publishOutput(reservation: OutputReservation): Promise<void> {
        if (reservation.published === true || reservation.temporaryPath === null) {
            return;
        }
        await fs.promises.stat(reservation.temporaryPath);
        await FileUtil.copyFile(reservation.temporaryPath, reservation.finalPath);
        reservation.published = true;
    }

    /**
     * ffmpeg プロセスを起動し、その終了と後続処理の完了を待つ。標準エラー出力は debug ログへ
     * 転送するのみで、標準出力は読み捨てる（`create`のバッファ滞留防止のため listener だけ張る）。
     * @param videoFileId 元になった video file id（ログ・イベント通知用）
     * @param recordedId 対象の録画id（DB登録・イベント通知用）
     * @param bin 実行するコマンド
     * @param args コマンド引数
     * @param reservation 出力予約
     */
    private async runGeneration(
        videoFileId: apid.VideoFileId,
        recordedId: apid.RecordedId,
        bin: string,
        args: string[],
        reservation: OutputReservation,
    ): Promise<void> {
        const request: GenerationRequest = {
            requestId: reservation.requestId,
            businessComplete: false,
            childTerminal: false,
            failure: null,
            settled: false,
        };
        const deadline = performance.now() + ThumbnailManageModel.processTimeoutMs();
        let child: ChildProcess;
        try {
            child = spawn(bin, args);
        } catch (err: any) {
            this.logReservationFailure('spawn', reservation, err);
            await this.cleanupReservation(reservation, false);
            throw err;
        }

        child.stderr!.on('data', data => {
            this.log.system.debug(String(data));
        });
        child.stdout!.on('data', () => {});

        await this.awaitChildSettlement(child, deadline, request, reservation, videoFileId, recordedId);
    }

    /**
     * ffmpeg プロセスの `close`/`error`（`childTerminal`）と、成功時の後続処理
     * （出力の公開・DB登録、`businessComplete`）の両方が終わって初めて Promise を解決/棄却する
     * （`finalize`）。プロセスがタイムアウト（`deadline`）まで生存し続けた場合は強制終了する。
     * @param child 監視対象の子プロセス
     * @param deadline このプロセスを許容する終了時刻（`performance.now()`基準）
     * @param request この呼び出し1回分の状態
     * @param reservation 出力予約
     * @param videoFileId 元になった video file id（ログ・イベント通知用）
     * @param recordedId 対象の録画id（DB登録・イベント通知用）
     * @returns 生成〜後続処理まで含めて成功したら解決、失敗したら reject する
     */
    private awaitChildSettlement(
        child: ChildProcess,
        deadline: number,
        request: GenerationRequest,
        reservation: OutputReservation,
        videoFileId: apid.VideoFileId,
        recordedId: apid.RecordedId,
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let deadlineTimer: NodeJS.Timeout | null = null;
            let finalization: Promise<void> | null = null;
            const clearDeadline = (): void => {
                if (deadlineTimer === null) {
                    return;
                }
                clearTimeout(deadlineTimer);
                deadlineTimer = null;
            };
            const removeListeners = (): void => {
                child.removeListener('close', onClose);
                child.removeListener('error', onError);
                child.stderr!.removeAllListeners('data');
                child.stdout!.removeAllListeners('data');
            };
            const finalize = (): void => {
                if (request.childTerminal === false || request.businessComplete === false || finalization !== null) {
                    return;
                }
                finalization = (async (): Promise<void> => {
                    clearDeadline();
                    removeListeners();
                    if (request.failure !== null) {
                        await this.cleanupReservation(reservation, false);
                        reject(request.failure);
                        return;
                    }
                    await this.cleanupReservation(reservation, true);
                    resolve();
                })();
            };
            const settleFailure = (operation: string, failure: Error): void => {
                request.settled = true;
                request.businessComplete = true;
                request.failure = failure;
                clearDeadline();
                this.logReservationFailure(operation, reservation, failure);
                void finalize();
            };
            const settleSuccess = (): void => {
                request.settled = true;
                clearDeadline();
                void (async (): Promise<void> => {
                    try {
                        this.log.system.info(`create thumbnail: ${videoFileId}, ${reservation.finalPath}`);
                        await this.publishOutput(reservation);
                    } catch (err: any) {
                        request.failure = err;
                        this.logReservationFailure('publish', reservation, err);
                        request.businessComplete = true;
                        void finalize();
                        return;
                    }

                    const thumbnail = new Thumbnail();
                    thumbnail.filePath = reservation.fileName;
                    thumbnail.recordedId = recordedId;
                    try {
                        await this.thumbnailDB.insertOnce(thumbnail);
                    } catch (err: any) {
                        request.failure = err;
                        this.logReservationFailure('database', reservation, err);
                        request.businessComplete = true;
                        void finalize();
                        return;
                    }

                    this.thumbnailEvent.emitAdded(videoFileId, recordedId);
                    request.businessComplete = true;
                    void finalize();
                })();
            };
            const onClose = (code: number | null): void => {
                request.childTerminal = true;
                if (request.settled === false) {
                    if (performance.now() >= deadline) {
                        onDeadline();
                    } else if (code === 0) {
                        settleSuccess();
                    } else {
                        this.log.system.error(`create thumbnail cmd error: ${code}`);
                        settleFailure('process', new Error('CreateThumbnailExitError'));
                    }
                }
                void finalize();
            };
            const onError = (err: Error): void => {
                if (request.settled === false) {
                    this.log.system.error(`create thumbnail failed: ${videoFileId}`);
                    settleFailure('spawn', err);
                }
                if (typeof child.pid === 'undefined') {
                    request.childTerminal = true;
                    void finalize();
                }
            };
            const onDeadline = (): void => {
                settleFailure('deadline', new Error('ThumbnailProcessTimeout'));
                void ProcessUtil.kill(child).catch(err => {
                    this.logReservationFailure('stop', reservation, err);
                });
            };

            deadlineTimer = setTimeout(onDeadline, Math.max(0, deadline - performance.now()));
            child.on('close', onClose);
            child.on('error', onError);
        });
    }

    /**
     * 出力予約の一時ディレクトリ・一時ファイルを削除し、`activeReservations`から取り除く。
     * `keepFinal`が`false`の場合は最終出力パス（`reserveOutput`で確保したファイル）も削除する
     * （生成失敗時、排他生成した空/不完全なファイルを残さないため）。多重実行は無視する。
     * @param reservation 対象の出力予約
     * @param keepFinal `true`なら最終出力ファイルは残す（生成成功時）
     */
    private async cleanupReservation(reservation: OutputReservation, keepFinal: boolean): Promise<void> {
        if (reservation.released === true) {
            return;
        }
        reservation.released = true;

        if (reservation.temporaryPath !== null) {
            await FileUtil.unlink(reservation.temporaryPath).catch(err => {
                if (err?.code !== 'ENOENT') {
                    this.logReservationFailure('cleanup temporary file', reservation, err);
                }
            });
        }
        if (reservation.temporaryDirectory !== null) {
            await fs.promises.rm(reservation.temporaryDirectory, { force: true, recursive: true }).catch(err => {
                this.logReservationFailure('cleanup temporary directory', reservation, err);
            });
        }
        if (keepFinal === false) {
            await FileUtil.unlink(reservation.finalPath).catch(err => {
                this.logReservationFailure('cleanup final file', reservation, err);
            });
        }
        this.activeReservations.delete(reservation);
    }

    /**
     * `filePath`が現在進行中のいずれかの出力予約（最終パスまたはその一時ディレクトリ配下）に
     * 該当するかを調べる。`fileCleanup`が、DB未登録でも生成処理が進行中で消してはいけない
     * ファイルを誤って削除しないようにするための判定に使う。
     * @param filePath 判定対象のファイルパス
     * @returns 進行中の予約に属するなら `true`
     */
    private isActiveReservationPath(filePath: string): boolean {
        const resolvedFilePath = path.resolve(filePath);
        for (const reservation of this.activeReservations) {
            if (path.resolve(reservation.finalPath) === resolvedFilePath) {
                return true;
            }
            if (reservation.temporaryDirectory === null) {
                continue;
            }
            const resolvedTemporaryDirectory = path.resolve(reservation.temporaryDirectory);
            if (
                resolvedTemporaryDirectory === resolvedFilePath ||
                resolvedFilePath.startsWith(`${resolvedTemporaryDirectory}${path.sep}`)
            ) {
                return true;
            }
        }
        return false;
    }

    private logReservationFailure(operation: string, reservation: OutputReservation, err: unknown): void {
        this.log.system.error(
            `thumbnail ${operation} failed: requestId=${reservation.requestId}, reservationId=${reservation.reservationId}`,
        );
        this.log.system.error(err);
    }

    /**
     * 指定したサムネイルを削除する
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<void>
     */
    public async delete(thumbnailId: apid.ThumbnailId): Promise<void> {
        const thumbnail = await this.thumbnailDB.findId(thumbnailId);
        if (thumbnail === null) {
            throw new Error('ThumbnailIsNotFound');
        }

        this.log.system.info(`delete thumbnail ${thumbnailId}`);

        // DB から削除
        await this.thumbnailDB.deleteOnce(thumbnailId).catch(err => {
            this.log.system.error(`delete thumbnail error: ${thumbnailId}`);
            this.log.system.error(err);
            throw err;
        });

        // サムネイルファイルを削除
        const filePath = path.join(this.config.thumbnail, thumbnail.filePath);
        await FileUtil.unlink(filePath).catch(err => {
            this.log.system.error(`delete thumbnail error: ${thumbnailId}`);
            this.log.system.error(err);
            throw err;
        });

        this.thumbnailEvent.emitDeleted();
    }

    /**
     * サムネイル再生性
     * @return Promise<void>
     */
    public async regenerate(): Promise<void> {
        this.log.system.info('start regenerate thumbnail');

        const [recordeds] = await this.recordedDB.findAll(
            {
                isHalfWidth: false,
            },
            {
                isNeedVideoFiles: true,
                isNeedThumbnails: true,
                isNeedsDropLog: false,
                isNeedTags: false,
            },
        );

        const targets: { recordedId: apid.RecordedId; videoFileId: apid.VideoFileId }[] = [];
        for (const recorded of recordeds) {
            if (typeof recorded.videoFiles === 'undefined' || recorded.videoFiles.length === 0) {
                continue;
            }

            if (typeof recorded.thumbnails === 'undefined' || recorded.thumbnails.length === 0) {
                // サムネイルが存在しないので生成リストに追加
                targets.push({ recordedId: recorded.id, videoFileId: recorded.videoFiles[0].id });
                continue;
            }

            // ファイルが存在しないサムネイルデータを列挙する
            const nonExistingThumbnailIds: apid.ThumbnailId[] = [];
            let existingThumbnailCnt = 0;

            // サムネイルファイルが存在するか確認
            for (const thumbnail of recorded.thumbnails) {
                const thumbnailPath = path.join(this.config.thumbnail, thumbnail.filePath);
                try {
                    await FileUtil.stat(thumbnailPath);
                    // ファイルが存在するので無視
                    existingThumbnailCnt++;
                    continue;
                } catch (err: any) {
                    // ファイルが存在しない
                    nonExistingThumbnailIds.push(thumbnail.id);
                }
            }

            // 存在しないサムネイルデータを削除する
            for (const thumbnailId of nonExistingThumbnailIds) {
                await this.thumbnailDB.deleteOnce(thumbnailId).catch(err => {
                    this.log.system.error(`failed to delete non-existing thumbnail data: ${thumbnailId}`);
                    this.log.system.error(err);
                });
            }

            // サムネイル情報が存在しなくなったので生成リストに追加
            if (existingThumbnailCnt === 0) {
                targets.push({ recordedId: recorded.id, videoFileId: recorded.videoFiles[0].id });
            }
        }

        // 再生成リストにある videoFileId からサムネイルを再生成させる
        for (const target of targets) {
            try {
                this.add(target.videoFileId);
            } catch (err: any) {
                this.log.system.error(
                    `failed to add regenerated thumbnail: recordedId=${target.recordedId}, videoFileId=${target.videoFileId}`,
                );
                this.log.system.error(err);
            }
        }
    }

    /**
     * DB に登録されていないログファイル削除 &  DB に登録されているが存在しないログ情報の削除
     */
    public async fileCleanup(): Promise<void> {
        this.log.system.info('start thumbnail files cleanup');
        const thumbnails = await this.thumbnailDB.findAll();

        // ファイル, ディレクトリ索引生成と DB 上に存在するが実ファイルが存在しないデータを削除する
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        for (const thumbnail of thumbnails) {
            const filePath = path.join(this.config.thumbnail, thumbnail.filePath);

            if ((await this.checkFileExistence(filePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[filePath] = true;
            } else {
                this.log.system.warn(`thumbnail file is not exist: ${filePath}`);
                // ファイルが存在しないなら削除
                await this.thumbnailDB.deleteOnce(thumbnail.id).catch(err => {
                    this.log.system.error(err);
                });
            }
        }

        // ファイル索引上に存在しないファイルを削除する
        const managedRootIdentity = FileUtil.captureManagedRootIdentity(this.config.thumbnail);
        const list = await FileUtil.getFileList(this.config.thumbnail);
        const activeFinalPaths = new Set<string>();
        for (const reservation of this.activeReservations) {
            activeFinalPaths.add(path.resolve(reservation.finalPath));
        }
        const currentFileIndex: { [filePath: string]: boolean } = {};
        for (const thumbnail of await this.thumbnailDB.findAll()) {
            currentFileIndex[path.join(this.config.thumbnail, thumbnail.filePath)] = true;
        }
        for (const file of list.files) {
            if (
                typeof fileIndex[file] !== 'undefined' ||
                typeof currentFileIndex[file] !== 'undefined' ||
                activeFinalPaths.has(path.resolve(file))
            ) {
                continue;
            }

            if (this.isActiveReservationPath(file)) {
                continue;
            }

            if (FileUtil.isManagedEntrySafeForRemoval(this.config.thumbnail, file, managedRootIdentity) === false) {
                this.log.system.error(`refused unsafe thumbnail cleanup file: ${file}`);
                continue;
            }

            this.log.system.info(`delete thumbnail file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to thumbnail file: ${file}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info('start thumbnail files cleanup completed');
    }
    /**
     * 指定したファイルパスにファイルが存在するか
     * @param filePath: string ファイルパス
     * @return Promise<boolean> ファイルが存在するなら true を返す
     */
    private async checkFileExistence(filePath: string): Promise<boolean> {
        try {
            await FileUtil.stat(filePath);

            return true;
        } catch (err: any) {
            return false;
        }
    }
}
