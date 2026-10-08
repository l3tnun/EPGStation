import { inject, injectable } from 'inversify';
import { constants as fsConstants, type Stats } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, realpath, rmdir, stat, unlink } from 'node:fs/promises';
import * as path from 'path';
import type * as apid from '../../../../api.js';
import DropLogFile from '../../../db/entities/DropLogFile.js';
import Recorded from '../../../db/entities/Recorded.js';
import VideoFile from '../../../db/entities/VideoFile.js';
import FileUtil from '../../../util/FileUtil.js';
import StrUtil from '../../../util/StrUtil.js';
import { stripLeadingSeparators } from '../../../util/SubDirectoryUtil.js';
import IVideoUtil from '../../api/video/IVideoUtil.js';
import IDropLogFileDB from '../../db/IDropLogFileDB.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IRecordedHistoryDB from '../../db/IRecordedHistoryDB.js';
import IThumbnailDB from '../../db/IThumbnailDB.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IRecordedEvent from '../../event/IRecordedEvent.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IRecordingManageModel from '../recording/IRecordingManageModel.js';
import IRecordedManageModel, { AddVideoFileOption, UploadedVideoFileOption } from './IRecordedManageModel.js';
import IRecordingUtilModel from '../recording/IRecordingUtilModel.js';
import IPreparedRecordedDeletionProvider, {
    PreparedRecordedDeletionToken,
    UserDeletionPreparation,
} from './IPreparedRecordedDeletionProvider.js';
import IPreparedVideoFileDeletionProvider, {
    PreparedVideoFileDeletionToken,
    VideoFileDeletionPreparation,
    VideoFileDeletionResult,
} from './IPreparedVideoFileDeletionProvider.js';
import IRecordedStorageDeletionProvider, {
    StorageDeletionPreparation,
    StorageDeletionPreparationToken,
} from './IRecordedStorageDeletionProvider.js';
import PreparedDeletionTokenRegistry, { PreparedDeletionToken } from './PreparedDeletionTokenRegistry.js';
import RecordedResourceMutationLock from './RecordedResourceMutationLock.js';

/** アップロードされたファイルの、open済み file descriptor を表す最小限の契約。
 *  テスト時に実 filesystem を差し替えられるよう`UploadFileSystem`経由でのみ扱う。 */
interface UploadFileHandle {
    readonly fd: number;
    stat(): Promise<Stats>;
    close(): Promise<void>;
}

/** アップロード処理が使う filesystem 操作の契約。実装は`uploadFileSystem`（`node:fs/promises`
 *  そのまま）だが、テストでは差し替え可能にするため class の field として持つ。 */
interface UploadFileSystem {
    copyFile(source: string, destination: string, mode?: number): Promise<void>;
    link(source: string, destination: string): Promise<void>;
    lstat(filePath: string): Promise<Stats>;
    mkdir(directory: string): Promise<string | undefined | void>;
    open(filePath: string, flags: number): Promise<UploadFileHandle>;
    realpath(filePath: string): Promise<string>;
    rmdir(directory: string): Promise<void>;
    stat(filePath: string): Promise<Stats>;
    unlink(filePath: string): Promise<void>;
}

const uploadFileSystem: UploadFileSystem = { copyFile, link, lstat, mkdir, open, realpath, rmdir, stat, unlink };

const uploadCandidateLimit = 10_000;
const uploadNameMaxBytes = 255;
/** アップロード先ディレクトリを、シンボリックリンクを辿らせず読み取り専用でopenするための
 *  フラグ（symlink差し替えによるディレクトリの成り済ましを防ぐ）。 */
const uploadDirectoryOpenFlags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;

const fileSystemErrorCode = (error: unknown): string | undefined =>
    error instanceof Error && 'code' in error ? String(error.code) : undefined;

/** アップロード処理中に作成したファイルを、失敗時に後始末するための削除試行の重複防止。
 *  同じパスへの削除は1回しか実行しない。 */
class UploadOwnerCleanup {
    private readonly attemptedPaths = new Set<string>();

    constructor(private readonly fileSystem: UploadFileSystem) {}

    public async remove(filePath: string): Promise<void> {
        if (this.attemptedPaths.has(filePath)) {
            return;
        }
        this.attemptedPaths.add(filePath);
        await this.fileSystem.unlink(filePath);
    }

    public async bestEffort(filePath: string): Promise<void> {
        await this.remove(filePath).catch(() => undefined);
    }
}

/** file descriptor を持たない（Linux 以外の）固定で使う、何も閉じない handle。 */
const pathOnlyHandle: Pick<UploadFileHandle, 'close'> = { close: async () => undefined };

/** アップロード先・削除先ディレクトリを固定して保持する。Linuxでは file descriptor で開いたまま保持し
 *  （`identity`のdev/inoで、後続の書き込み先が open 時点と同じディレクトリのままであることを
 *  確認できるようにする、TOCTOU対策）、`descriptorPath`は`/proc/self/fd/<fd>`になる。Linux以外では
 *  descriptor を保持せず、`descriptorPath`は`logicalPath`と同じ実pathになり、操作の直前に
 *  `boundary`（保存先root）から`logicalPath`までを確認し直す。`close`は多重呼び出しでも同じ Promise を返す。 */
class PinnedUploadDirectory {
    private closePromise: Promise<void> | undefined;

    constructor(
        public readonly logicalPath: string,
        public readonly descriptorPath: string,
        public readonly identity: Pick<Stats, 'dev' | 'ino'>,
        private readonly handle: Pick<UploadFileHandle, 'close'>,
        public readonly boundary: string = logicalPath,
    ) {}

    public close(): Promise<void> {
        if (typeof this.closePromise === 'undefined') {
            this.closePromise = this.handle.close();
        }
        return this.closePromise;
    }
}

interface PlacedUploadFile {
    /** 配置先として固定したディレクトリ。後始末の前に、Linux以外では確認し直すために保持する。 */
    readonly directory: PinnedUploadDirectory;
    readonly descriptorPath: string;
    readonly logicalPath: string;
}

/** `PreparedDeletionTokenRegistry`が扱うtokenの種類。`prepare*`/`deletePrepared*`の
 *  組み合わせを取り違えないようにする。 */
type DeletionTokenKind = 'recorded' | 'video-file' | 'storage';
type ManagedFileRemovalResult = 'removed' | 'unsafe-path' | 'unlink-attempt-failed';
/** `videoFileCleanup`/`dropLogFileCleanup`の多重実行防止に使う状態。 */
type CleanupState = 'idle' | 'running';

/** `prepare*Deletion`が発行するtokenの中身。`prepare`時点でのrecordedId・録画状態・
 *  予約idのスナップショットを保持し、`deletePrepared*`側で「prepare時点から状態が
 *  変わっていないか」（録画が始まった・保護されたに変わった等）を再確認するのに使う。 */
type DeletionTokenValue =
    | {
          readonly kind: 'recorded';
          readonly recordedId: apid.RecordedId;
          readonly isRecording: boolean;
          readonly reserveId: apid.ReserveId | null;
      }
    | {
          readonly kind: 'video-file';
          readonly recordedId: apid.RecordedId;
          readonly videoFileId: apid.VideoFileId;
      }
    | {
          readonly kind: 'storage';
          readonly recordedId: apid.RecordedId;
          readonly storageName: string;
      };

/**
 * `IRecordedManageModel`の実装。削除系の操作（録画・動画ファイル・ストレージ単位）は
 * いずれも「`prepare*`で対象を確認してtokenを発行→`deletePrepared*`でtokenを消費して
 * 実削除」という二段階になっている。`prepare*`と`deletePrepared*`の間に対象の状態が
 * 変わる可能性があるため、`deletePrepared*`側は`resourceMutationLock`で同一recordedIdへの
 * 操作を直列化したうえで、DBから読み直した最新状態がtoken発行時点と一致するかを
 * 再確認してから実際にファイル・DB行を削除する。アップロード処理は、アップロード先
 * ディレクトリをfile descriptorで固定（`PinnedUploadDirectory`）してからその識別子
 * （dev/ino）で書き込み先を確認することで、シンボリックリンク差し替え等による
 * 意図しない場所への書き込みを防いでいる。
 */
@injectable()
export default class RecordedManageModel
    implements
        IRecordedManageModel,
        IPreparedRecordedDeletionProvider,
        IPreparedVideoFileDeletionProvider,
        IRecordedStorageDeletionProvider
{
    private log: ILogger;
    private config: IConfigFile;
    private recordedDB: IRecordedDB;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private dropLogFileDB: IDropLogFileDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private recordingManageModel: IRecordingManageModel;
    private recordedEvent: IRecordedEvent;
    private videoUtil: IVideoUtil;
    private recordingUtilModel: IRecordingUtilModel;
    /** アップロード処理が使う filesystem 操作。既定は実 filesystem（`uploadFileSystem`）。 */
    private uploadFileSystem: UploadFileSystem = uploadFileSystem;
    /** 保存先の操作の方法を決めるplatform。未設定なら実行中のplatform。Linuxだけが file descriptor を
     *  経由し、Linux以外は確認した実pathを指定して操作する。 */
    private uploadPlatform: NodeJS.Platform | undefined;
    /** `prepare*Deletion`が発行したtokenと、その中身（`DeletionTokenValue`）の対応を保持する
     *  registry。`deletePrepared*`はここからtokenを消費（一度きり）して中身を取り出す。 */
    private preparedDeletionTokens = new PreparedDeletionTokenRegistry<DeletionTokenValue, DeletionTokenKind>();
    /** recordedId単位で削除系操作を直列化するための lock。同じ録画に対する削除操作が
     *  並行して走ることで生じる競合（二重削除・状態確認のすり抜け）を防ぐ。 */
    private resourceMutationLock = new RecordedResourceMutationLock<apid.RecordedId>();
    /** `videoFileCleanup`が実行中か（多重実行防止）。 */
    private videoFileCleanupState: CleanupState = 'idle';
    /** `dropLogFileCleanup`が実行中か（多重実行防止）。 */
    private dropLogFileCleanupState: CleanupState = 'idle';

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IDropLogFileDB') dropLogFileDB: IDropLogFileDB,
        @inject('IRecordedHistoryDB') recordedHistoryDB: IRecordedHistoryDB,
        @inject('IRecordingManageModel')
        recordingManageModel: IRecordingManageModel,
        @inject('IRecordedEvent') recordedEvent: IRecordedEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IRecordingUtilModel') recordingUtilModel: IRecordingUtilModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.recordedDB = recordedDB;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.dropLogFileDB = dropLogFileDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.recordingManageModel = recordingManageModel;
        this.recordedEvent = recordedEvent;
        this.videoUtil = videoUtil;
        this.recordingUtilModel = recordingUtilModel;
        void this.deleteExactRecordedResources;
    }

    /**
     * 録画（DB行・関連ファイル一式）の削除準備。対象が保護されていれば拒否し、
     * そうでなければ現在の状態（録画中か・予約idは何か）を焼き込んだtokenを発行する。
     * @param recordedId 削除したい録画のid
     * @returns 準備結果。`'prepared'`ならtokenを含む
     */
    public async prepareUserDeletion(recordedId: apid.RecordedId): Promise<UserDeletionPreparation> {
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            return { status: 'not-found' };
        }
        if (recorded.isProtected) {
            return { status: 'protected' };
        }
        const value: DeletionTokenValue = {
            kind: 'recorded',
            recordedId,
            isRecording: recorded.isRecording,
            reserveId: recorded.reserveId,
        };
        return {
            status: 'prepared',
            token: this.getPreparedDeletionTokens().prepare(
                'recorded',
                value,
            ) as unknown as PreparedRecordedDeletionToken,
            isRecording: value.isRecording,
            reserveId: value.reserveId,
        };
    }

    /**
     * `prepareUserDeletion`で発行されたtokenを消費し、対象recordedIdへの排他制御下で
     * 現在の状態を読み直して再確認したうえで実削除する。tokenの内容（録画状態・予約id）と
     * 現在のDBの内容が食い違っていれば（prepare後に状態が変わっていれば）削除を拒否する。
     * @param token `prepareUserDeletion`が発行したtoken（一度しか使えない）
     * @throws 対象が見つからない・保護されている・prepare時点から状態が変わっている場合
     */
    public async deletePrepared(token: PreparedRecordedDeletionToken): Promise<void> {
        const value = this.consumeDeletionToken('recorded', token);
        await this.getResourceMutationLock().runExclusive(value.recordedId, async () => {
            const recorded = await this.recordedDB.findId(value.recordedId);
            if (recorded === null) {
                throw new Error('RecordedIdIsNotFound');
            }
            if (recorded.isProtected) {
                throw new Error('RecordedIsProtected');
            }
            if (recorded.isRecording !== value.isRecording || recorded.reserveId !== value.reserveId) {
                throw new Error('RecordedDeletionStateChanged');
            }
            await this.deleteExactRecordedResources(recorded);
        });
    }

    /**
     * 動画ファイル単体の削除準備。対象の録画が保護されている、録画中である、または
     * この動画ファイルが最後の1本である場合は単体削除を許可せず、録画ごとの削除
     * （`'whole-recorded-deletion-required'`）が必要と伝える。
     * @param videoFileId 削除したい動画ファイルのid
     * @returns 準備結果
     */
    public async prepareVideoFileDeletion(videoFileId: apid.VideoFileId): Promise<VideoFileDeletionPreparation> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            return { status: 'not-found' };
        }
        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) {
            return { status: 'not-found' };
        }
        if (recorded.isProtected) {
            return { status: 'protected' };
        }
        const videoFiles = recorded.videoFiles ?? [];
        if (!videoFiles.some(relation => relation.id === videoFileId)) {
            return { status: 'not-found' };
        }
        if (recorded.isRecording || videoFiles.length <= 1) {
            return { status: 'whole-recorded-deletion-required', recordedId: recorded.id };
        }
        const value: DeletionTokenValue = {
            kind: 'video-file',
            recordedId: recorded.id,
            videoFileId,
        };
        return {
            status: 'prepared',
            token: this.getPreparedDeletionTokens().prepare(
                'video-file',
                value,
            ) as unknown as PreparedVideoFileDeletionToken,
        };
    }

    /**
     * `prepareVideoFileDeletion`で発行されたtokenを消費し、対象recordedIdへの排他制御下で
     * 現在の状態を再確認したうえで、その動画ファイルだけを削除する。
     * @param token `prepareVideoFileDeletion`が発行したtoken
     * @returns 削除結果（見つからない/保護されている/録画ごとの削除が必要/削除成功）
     */
    public async deletePreparedVideoFile(token: PreparedVideoFileDeletionToken): Promise<VideoFileDeletionResult> {
        const value = this.consumeDeletionToken('video-file', token);
        return this.getResourceMutationLock().runExclusive(value.recordedId, async () => {
            const recorded = await this.recordedDB.findId(value.recordedId);
            if (recorded === null) {
                return { status: 'not-found' };
            }
            if (recorded.isProtected) {
                return { status: 'protected' };
            }
            const videoFiles = recorded.videoFiles;
            if (videoFiles == null) {
                return { status: 'not-found' };
            }
            const finalVideoRelation = videoFiles.find(relation => relation.id === value.videoFileId);
            if (typeof finalVideoRelation === 'undefined') {
                return { status: 'not-found' };
            }
            const video = Object.freeze({
                id: finalVideoRelation.id,
                parentDirectoryName: finalVideoRelation.parentDirectoryName,
                filePath: finalVideoRelation.filePath,
            });
            if (recorded.isRecording || videoFiles.length <= 1) {
                return { status: 'whole-recorded-deletion-required', recordedId: value.recordedId };
            }

            const root = this.getVideoFileRoot(video.parentDirectoryName);
            if ((await this.removeManagedFile(root, video.filePath)) === 'unsafe-path') {
                throw new Error('VideoFileDeletionFailed');
            }
            await this.videoFileDB.deleteOnce(video.id);
            this.recordedEvent.emitDeleteVideoFile(video.id);
            return { status: 'video-file-deleted' };
        });
    }

    /**
     * ストレージ容量確保のための自動削除の準備（`getStorageDeletionRefusal`で拒否理由が
     * 無いか確認したうえでtokenを発行する）。ユーザー操作による削除（`prepareUserDeletion`）
     * とは拒否条件が異なる場合があるため別のtoken種別として扱う。
     * @param recordedId 削除候補の録画id
     * @param storageName この削除が対象とする保存先ディレクトリ名
     * @returns 準備結果
     */
    public async prepareStorageDeletion(
        recordedId: apid.RecordedId,
        storageName: string,
    ): Promise<StorageDeletionPreparation> {
        const recorded = await this.recordedDB.findId(recordedId);
        const reason = this.getStorageDeletionRefusal(recorded, storageName);
        if (reason !== null) {
            return { status: 'not-deleted', reason };
        }
        const value: DeletionTokenValue = { kind: 'storage', recordedId, storageName };
        return {
            status: 'prepared',
            token: this.getPreparedDeletionTokens().prepare(
                'storage',
                value,
            ) as unknown as StorageDeletionPreparationToken,
        };
    }

    /**
     * `prepareStorageDeletion`で発行されたtokenを消費し、対象recordedIdへの排他制御下で
     * 拒否条件を再確認したうえで実削除する。
     * @param token `prepareStorageDeletion`が発行したtoken
     * @returns 実際に削除できたか
     */
    public async deletePreparedForStorage(token: StorageDeletionPreparationToken): Promise<'deleted' | 'not-deleted'> {
        const value = this.consumeDeletionToken('storage', token);
        return this.getResourceMutationLock().runExclusive(value.recordedId, async () => {
            const recorded = await this.recordedDB.findId(value.recordedId);
            if (this.getStorageDeletionRefusal(recorded, value.storageName) !== null) {
                return 'not-deleted';
            }
            await this.deleteExactRecordedResources(recorded as Recorded);
            return 'deleted';
        });
    }

    private getPreparedDeletionTokens(): PreparedDeletionTokenRegistry<DeletionTokenValue, DeletionTokenKind> {
        if (typeof this.preparedDeletionTokens === 'undefined') {
            this.preparedDeletionTokens = new PreparedDeletionTokenRegistry();
        }
        return this.preparedDeletionTokens;
    }

    private getResourceMutationLock(): RecordedResourceMutationLock<apid.RecordedId> {
        if (typeof this.resourceMutationLock === 'undefined') {
            this.resourceMutationLock = new RecordedResourceMutationLock();
        }
        return this.resourceMutationLock;
    }

    private consumeDeletionToken<K extends DeletionTokenKind>(
        kind: K,
        token: object,
    ): Extract<DeletionTokenValue, { readonly kind: K }> {
        const consumption = this.getPreparedDeletionTokens().consume(kind, token as PreparedDeletionToken);
        if (consumption.type !== 'consumed') {
            throw new Error(consumption.type);
        }
        return consumption.value as Extract<DeletionTokenValue, { readonly kind: K }>;
    }

    private getStorageDeletionRefusal(
        recorded: Recorded | null,
        storageName: string,
    ): import('./IRecordedStorageDeletionProvider.js').StorageDeletionNotDeletedReason | null {
        if (recorded === null) {
            return 'recorded-not-found';
        }
        if (recorded.isProtected) {
            return 'protected';
        }
        if (recorded.isRecording) {
            return 'recording-active';
        }
        const videos = recorded.videoFiles ?? [];
        if (videos.length === 0) {
            return 'no-video-relations';
        }
        if (videos.some(video => video.parentDirectoryName !== storageName)) {
            return 'storage-mismatch';
        }
        return null;
    }

    /**
     * 指定した録画情報と各種ファイルを削除する
     * @param recordedId: RecordedId
     * @param isIgnoreProtection: boolean
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId, isIgnoreProtection: boolean = false): Promise<void> {
        this.log.system.info(`delete recorded: ${recordedId}`);
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            this.log.system.warn(`${recordedId} is null`);
            throw new Error('RecordedIdIsNotFound');
        }

        // プロテクトチェック
        if (recorded.isProtected === true) {
            this.log.system.warn(`${recordedId} is protected`);
            throw new Error('RecordedIsProtected');
        }

        // 録画中なら停止
        if (
            isIgnoreProtection === false &&
            recorded.isRecording === true &&
            recorded.reserveId !== null &&
            this.recordingManageModel.hasReserve(recorded.reserveId) === true
        ) {
            this.log.system.info(
                `cancel recording by recorded manager reserveId: ${recorded.reserveId} recordedId: ${recorded.id}`,
            );
            await this.recordingManageModel.cancel(recorded.reserveId, true);
        }

        const hasThumbnails = typeof recorded.thumbnails !== 'undefined' && recorded.thumbnails.length > 0;
        const hasVideoFiles = typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length > 0;

        // サムネイル実ファイル削除
        if (hasThumbnails === true && typeof recorded.thumbnails !== 'undefined') {
            for (const t of recorded.thumbnails) {
                await this.removeManagedFile(this.config.thumbnail, t.filePath);
            }
        }

        // 録画ファイル実ファイル削除
        if (hasVideoFiles === true && typeof recorded.videoFiles !== 'undefined') {
            for (const v of recorded.videoFiles) {
                await this.removeManagedFile(this.getVideoFileRoot(v.parentDirectoryName), v.filePath);
            }
        }

        // ドロップログファイル削除処理
        if (typeof recorded.dropLogFile !== 'undefined' && recorded.dropLogFile !== null) {
            await this.removeManagedFile(this.config.dropLog, recorded.dropLogFile.filePath);
        }

        // DB からサムネイル情報削除
        if (hasThumbnails === true) {
            this.thumbnailDB.deleteRecordedId(recordedId).catch(err => {
                this.log.system.error(`falied to delete thumbnail data: ${recordedId}`);
                this.log.system.error(err);
            });
        }

        // DB から録画ファイル情報削除
        if (hasVideoFiles === true) {
            await this.videoFileDB.deleteRecordedId(recordedId).catch(err => {
                this.log.system.error(`falied to delete video data: ${recordedId}`);
                this.log.system.error(err);
            });
        }

        // DB から録画情報削除
        await this.recordedDB.deleteOnce(recordedId).catch(err => {
            this.log.system.error(`falied to delete recorded data: ${recordedId}`);
            this.log.system.error(err);
        });

        // DB からドロップログファイル情報削除
        if (typeof recorded.dropLogFile !== 'undefined' && recorded.dropLogFile !== null) {
            await this.dropLogFileDB.deleteOnce(recorded.dropLogFile.id).catch(err => {
                this.log.system.error(`failed to delete drop log data: ${recorded.dropLogFile?.id}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info(`successful delete recorded: ${recordedId}`);

        // イベント発行
        this.recordedEvent.emitDeleteRecorded(recorded);
    }

    private async deleteExactRecordedResources(recorded: Recorded): Promise<void> {
        await this.removeRecordedFiles(recorded);

        const relationMutations = [
            ...(recorded.videoFiles ?? []).map(video => this.videoFileDB.deleteOnce(video.id)),
            ...(recorded.thumbnails ?? []).map(thumbnail => this.thumbnailDB.deleteOnce(thumbnail.id)),
        ];
        const relationSettlements = await Promise.allSettled(relationMutations);

        let canonicalFailure: unknown;
        try {
            await this.recordedDB.deleteOnce(recorded.id);
        } catch (error) {
            canonicalFailure = error;
        }

        let dropLogFailure: unknown;
        if (typeof canonicalFailure === 'undefined' && recorded.dropLogFile != null) {
            try {
                await this.dropLogFileDB.deleteOnce(recorded.dropLogFile.id);
            } catch (error) {
                dropLogFailure = error;
            }
        }

        if (typeof canonicalFailure !== 'undefined') {
            throw canonicalFailure;
        }
        const relationFailure = relationSettlements.find(
            (settlement): settlement is PromiseRejectedResult => settlement.status === 'rejected',
        );
        if (typeof relationFailure !== 'undefined') {
            throw relationFailure.reason;
        }
        if (typeof dropLogFailure !== 'undefined') {
            throw dropLogFailure;
        }

        this.recordedEvent.emitDeleteRecorded(recorded);
    }

    private async removeRecordedFiles(recorded: Recorded): Promise<void> {
        for (const video of recorded.videoFiles ?? []) {
            await this.removeManagedFile(this.getVideoFileRoot(video.parentDirectoryName), video.filePath);
        }
        for (const thumbnail of recorded.thumbnails ?? []) {
            await this.removeManagedFile(this.config.thumbnail, thumbnail.filePath);
        }
        if (recorded.dropLogFile != null) {
            await this.removeManagedFile(this.config.dropLog, recorded.dropLogFile.filePath);
        }
    }

    /**
     * 録画ファイルの親ディレクトリ名から、削除の起点となる管理保存先rootを解決する。
     * 名前`tmp`は一時録画先（`recordedTmp`）を指す。解決できなければ`undefined`を返し、
     * `removeManagedFile`が拒否する。
     * @param parentDirectoryName 録画ファイルの親ディレクトリ名
     * @returns 管理保存先root、または`undefined`
     */
    private getVideoFileRoot(parentDirectoryName: string): string | undefined {
        return this.videoUtil.getParentDirPath(parentDirectoryName) ?? undefined;
    }

    /**
     * config.yml で管理されたディレクトリ（`root`）配下のファイルだけを安全に削除する。
     * `root`を`realpath`で解決したうえで、対象パスがそのディレクトリ配下（`..`で
     * 抜け出していない）ことを文字列比較で確認し、さらに親ディレクトリを
     * `openPinnedDeletionParent`でsymlinkを辿らせずに固定してから、その固定した
     * ディレクトリ内でのみ削除を実行する。DB上のパスとファイルシステムの実体の間に
     * symlink差し替え等があっても、管理範囲外を削除しないようにするための多重防御。
     * Linuxでは親をfile descriptorで開いたまま`/proc/self/fd/<fd>/<名前>`で削除する。Linux以外では
     * 削除の直前に`confirmDirectoryBeforeMutation`でrootから親までを確認し直し、実pathを指定して削除する
     * （確認から削除までの間の差し替えはLinux以外では防げない）。
     * @param root 管理対象ディレクトリ（未設定なら常に拒否）
     * @param relativePath `root`からの相対パス（先頭の区切り文字は取り除いて解釈する）
     * @returns 削除できたか、パスが不正で拒否したか、削除自体に失敗したか
     */
    private async removeManagedFile(root: string | undefined, relativePath: string): Promise<ManagedFileRemovalResult> {
        if (typeof root === 'undefined') {
            this.log.system.error(`managed root is not found for deletion: ${relativePath}`);
            return 'unsafe-path';
        }

        let resolvedRoot: string;
        try {
            resolvedRoot = await (this.uploadFileSystem ?? uploadFileSystem).realpath(root);
        } catch (error) {
            this.log.system.error(`failed to resolve managed root: ${root}`);
            this.log.system.error(error);
            return 'unsafe-path';
        }

        // 録画ファイルは`path.join(root, 登録path)`で作られるため、先頭の区切りを除いた残りをroot相対として扱う
        const registeredPath = this.stripLeadingSeparators(relativePath);
        const target = path.resolve(resolvedRoot, registeredPath);
        const relativeTarget = path.relative(resolvedRoot, target);
        if (
            path.isAbsolute(registeredPath) ||
            relativeTarget.length === 0 ||
            relativeTarget === '..' ||
            relativeTarget.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeTarget)
        ) {
            this.log.system.error(`refused out-of-root deletion: ${relativePath}`);
            return 'unsafe-path';
        }

        let parent: PinnedUploadDirectory;
        try {
            parent = await this.openPinnedDeletionParent(resolvedRoot, path.dirname(relativeTarget));
        } catch (error) {
            this.log.system.error(`refused unsafe deletion: ${target}`);
            this.log.system.error(error);
            return 'unsafe-path';
        }

        let result: ManagedFileRemovalResult = 'unlink-attempt-failed';
        try {
            try {
                await this.confirmDirectoryBeforeMutation(parent);
            } catch (error) {
                this.log.system.error(`refused unsafe deletion: ${target}`);
                this.log.system.error(error);
                return 'unsafe-path';
            }
            this.log.system.info(`delete: ${target}`);
            try {
                await FileUtil.unlink(path.join(parent.descriptorPath, path.basename(target)));
                result = 'removed';
            } catch (error) {
                this.log.system.error(`failed to delete ${target}`);
                this.log.system.error(error);
            }
        } finally {
            await parent.close().catch(error => {
                this.log.system.error(`failed to close deletion parent: ${target}`);
                this.log.system.error(error);
            });
        }
        return result;
    }

    /**
     * 登録された相対パスの先頭の区切り文字（`/`、Windowsでは`\`も）を取り除く。
     * 録画ファイルは`path.join(root, 登録path)`で作られ、`/anime/x.ts`もroot配下の`anime/x.ts`になるため、
     * 削除でも同じ解釈でroot相対のパスにする。
     * @param relativePath 登録された相対パス
     * @param platformPath 区切り文字を決めるplatform（既定は実行中のplatform）
     * @returns 先頭の区切り文字を取り除いたパス
     */
    private stripLeadingSeparators(relativePath: string, platformPath: Pick<path.PlatformPath, 'sep'> = path): string {
        return stripLeadingSeparators(relativePath, platformPath);
    }

    /**
     * `root`から`relativeParent`まで、1階層ずつ`openPinnedUploadDirectory`でopenし直しながら
     * 辿り、最終的な親ディレクトリだけを開いたまま返す（途中の階層は開き終えたら閉じる）。
     * 各階層でopenするため、途中のどこかがsymlinkに差し替えられていても`O_NOFOLLOW`で
     * 検知して失敗する。
     * @param root 起点となる管理対象ディレクトリ
     * @param relativeParent `root`からの相対パス（`'.'`ならroot自体）
     * @returns 開いたままの親ディレクトリ（呼び出し元が`close`する責任を持つ）
     */
    private async openPinnedDeletionParent(root: string, relativeParent: string): Promise<PinnedUploadDirectory> {
        const segments = relativeParent === '.' ? [] : relativeParent.split(path.sep);
        let current = await this.openPinnedUploadDirectory(root, root);
        for (const segment of segments) {
            let child: PinnedUploadDirectory;
            try {
                child = await this.openPinnedUploadDirectory(
                    path.join(current.logicalPath, segment),
                    path.join(current.descriptorPath, segment),
                    current.boundary,
                );
            } catch (error) {
                await current.close().catch(() => undefined);
                throw error;
            }
            try {
                await current.close();
            } catch (error) {
                await child.close().catch(() => undefined);
                throw error;
            }
            current = child;
        }
        return current;
    }

    /**
     * ドロップログファイルパス取得
     * @param dropLogFile: DropLogFile
     * @return string
     */
    private getDropLogFilePath(dropLogFile: DropLogFile): string {
        return path.join(this.config.dropLog, dropLogFile.filePath);
    }

    /**
     * 指定されて video file id のファイルサイズを更新する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>;
     */
    public async updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void> {
        this.log.system.info(`update video file size: ${videoFileId}`);

        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        const fileSize = await FileUtil.getFileSize(filePath);

        await this.videoFileDB.updateSize(videoFileId, fileSize);

        this.recordedEvent.emitUpdateVideoFileSize(videoFileId);
    }

    /**
     * option で指定されたビデオファイルを追加する
     * @param option: AddVideoFileOption
     * @return Promise<apid.VideoFileId>
     */
    public async addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId> {
        this.log.system.info(`add video file: ${option.recordedId} ${option.filePath}`);

        const newVideoFileId = await this.persistVideoFile(option);
        this.recordedEvent.emitAddVideoFile(newVideoFileId);

        return newVideoFileId;
    }

    private async persistVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId> {
        const parentDirPath = this.videoUtil.getParentDirPath(option.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(`parent directory is null: ${option.parentDirectoryName}`);
            throw new Error('ParentDirectoryIsNull');
        }

        const fileSize = await FileUtil.getFileSize(path.join(parentDirPath, option.filePath));

        return this.insertVideoFile(option, fileSize);
    }

    private async insertVideoFile(option: AddVideoFileOption, fileSize: number): Promise<apid.VideoFileId> {
        const videoFile = new VideoFile();
        videoFile.parentDirectoryName = option.parentDirectoryName;
        videoFile.filePath = option.filePath;
        videoFile.type = option.type;
        videoFile.name = option.name;
        videoFile.size = fileSize;
        videoFile.recordedId = option.recordedId;

        const newVideoFileId = await this.videoFileDB.insertOnce(videoFile).catch(err => {
            this.log.system.error(`failed to add video: ${option.parentDirectoryName}/${option.filePath}`);
            this.log.system.error(err);
            throw err;
        });

        return newVideoFileId;
    }

    /**
     * option で指定されたビデオファイルを追加する
     * @param option: UploadedVideoFileInfo
     * @return Promise<void>
     */
    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void> {
        this.log.system.info(`add uploaded file: ${option.recordedId}`);

        const cleanup = new UploadOwnerCleanup(this.uploadFileSystem ?? uploadFileSystem);
        const cleanAdopted = async (): Promise<void> => {
            await cleanup.bestEffort(option.filePath);
            await this.cleanAdoptedDirectory(option.filePath);
        };

        let directory: PinnedUploadDirectory | undefined;
        let placedFile: PlacedUploadFile | undefined;
        let recorded: Recorded;
        let videoFileId: apid.VideoFileId;
        try {
            // 指定された番組情報を取得
            const foundRecorded = await this.recordedDB.findId(option.recordedId);
            if (foundRecorded === null) {
                throw new Error('RecordedIdIsNull');
            }
            recorded = foundRecorded;

            // 親ディレクトリ
            const parentDirPath = this.videoUtil.getParentDirPath(option.parentDirectoryName);
            if (parentDirPath === null) {
                this.log.system.error(`parent directory is null: ${option.parentDirectoryName}`);
                throw new Error('ParentDirectoryIsNull');
            }

            const parentRoot = await (this.uploadFileSystem ?? uploadFileSystem).realpath(parentDirPath);
            const formattedSubDirectory =
                typeof option.subDirectory === 'undefined'
                    ? undefined
                    : await this.recordingUtilModel.formatFilePathString(option.subDirectory, recorded);
            directory = await this.prepareUploadDirectory(parentRoot, formattedSubDirectory);
            placedFile = await this.placeUploadedFile(option.filePath, directory, option.fileName, cleanup);
            await this.cleanAdoptedDirectory(option.filePath);
            await this.assertPinnedUploadDirectory(directory);

            const fileSize = (await (this.uploadFileSystem ?? uploadFileSystem).stat(placedFile.descriptorPath)).size;
            const filePath = placedFile.logicalPath;
            const fileName = path.basename(filePath);
            videoFileId = await this.insertVideoFile(
                {
                    recordedId: option.recordedId,
                    parentDirectoryName: option.parentDirectoryName,
                    filePath: path.relative(parentRoot, path.join(path.dirname(filePath), fileName)),
                    type: option.fileType,
                    name: option.viewName,
                },
                fileSize,
            );
        } catch (error) {
            if (error instanceof Error && error.message === 'FileMoveError') {
                this.log.system.error('move file error');
                this.log.system.error(error.cause ?? error);
            }
            if (typeof placedFile !== 'undefined') {
                await this.cleanUploadCandidate(placedFile.directory, cleanup, placedFile.descriptorPath);
            }
            await cleanAdopted();
            throw error;
        } finally {
            if (typeof directory !== 'undefined') {
                await directory.close().catch(error => {
                    this.log.system.error('failed to close pinned upload directory');
                    this.log.system.error(error);
                });
            }
        }

        try {
            this.recordedEvent.emitAddVideoFile(videoFileId);
        } catch (error) {
            this.log.system.error('failed to notify added video file');
            this.log.system.error(error);
        }
        const needsCreateThumbnail = typeof recorded.thumbnails === 'undefined' || recorded.thumbnails.length === 0;
        try {
            this.recordedEvent.emitAddUploadedVideoFile(videoFileId, needsCreateThumbnail);
        } catch (error) {
            this.log.system.error('failed to notify uploaded video file');
            this.log.system.error(error);
        }
    }

    private async prepareUploadDirectory(root: string, subDirectory?: string): Promise<PinnedUploadDirectory> {
        if (typeof subDirectory !== 'undefined' && subDirectory.includes('\\')) {
            throw new Error('UploadPathError');
        }
        const segments =
            typeof subDirectory === 'undefined' || subDirectory.length === 0 ? [] : subDirectory.split('/');
        if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
            throw new Error('UploadPathError');
        }

        let current = await this.openPinnedUploadDirectory(root, root);
        try {
            for (const segment of segments) {
                const logicalPath = path.join(current.logicalPath, segment);
                const descriptorPath = path.join(current.descriptorPath, segment);
                await this.ensureUploadDirectory(descriptorPath);
                const child = await this.openPinnedUploadDirectory(logicalPath, descriptorPath, current.boundary);
                try {
                    await current.close();
                } catch (error) {
                    await child.close().catch(() => undefined);
                    throw error;
                }
                current = child;
            }
            return current;
        } catch (error) {
            await current.close().catch(() => undefined);
            throw error;
        }
    }

    private async ensureUploadDirectory(directory: string): Promise<void> {
        const fileSystem = this.uploadFileSystem ?? uploadFileSystem;
        try {
            await fileSystem.mkdir(directory);
        } catch (error) {
            if (fileSystemErrorCode(error) !== 'EEXIST') {
                throw error;
            }
        }
    }

    private getUploadDescriptorPath(descriptor: number, platform: NodeJS.Platform = process.platform): string {
        return `${this.getUploadDescriptorRoot(platform)}/${descriptor}`;
    }

    private getUploadDescriptorRoot(platform: NodeJS.Platform = process.platform): string {
        if (platform === 'linux') {
            return '/proc/self/fd';
        }
        // file descriptor を経由するpathを持つのはLinuxだけ。`/dev/fd/<fd>/<名前>`はmacOSでENOENTになり、
        // Windowsにはdescriptorを経由するpathが無い。
        throw new Error('UploadPathError');
    }

    /** file descriptor を経由して操作するか（Linuxのみ）。Linux以外は確認した実pathを指定して操作する。 */
    private usesDescriptorPaths(): boolean {
        return (this.uploadPlatform ?? process.platform) === 'linux';
    }

    private async openPinnedUploadDirectory(
        logicalPath: string,
        accessPath: string,
        boundary: string = logicalPath,
    ): Promise<PinnedUploadDirectory> {
        if (!this.usesDescriptorPaths()) {
            return this.openPathPinnedDirectory(logicalPath, boundary);
        }
        const fileSystem = this.uploadFileSystem ?? uploadFileSystem;
        let handle: UploadFileHandle;
        try {
            handle = await fileSystem.open(accessPath, uploadDirectoryOpenFlags);
        } catch (error) {
            const code = fileSystemErrorCode(error);
            if (code === 'ELOOP' || code === 'ENOENT' || code === 'ENOTDIR') {
                throw new Error('UploadPathError', { cause: error });
            }
            throw error;
        }
        try {
            const stats = await handle.stat();
            if (!stats.isDirectory()) {
                throw new Error('UploadPathError');
            }
            const directory = new PinnedUploadDirectory(
                logicalPath,
                this.getUploadDescriptorPath(handle.fd, this.uploadPlatform),
                { dev: stats.dev, ino: stats.ino },
                handle,
                boundary,
            );
            await this.assertPinnedUploadDirectory(directory);
            return directory;
        } catch (error) {
            await handle.close().catch(() => undefined);
            throw error;
        }
    }

    /**
     * Linux以外で、file descriptor を保持せずにディレクトリを固定する。`logicalPath`を`lstat`し、
     * symbolic linkではない通常のディレクトリであることと、`boundary`（保存先root）内であることを
     * `assertPinnedUploadDirectory`で確認する。
     * @param logicalPath 固定するディレクトリの実path
     * @param boundary 保存先root（`realpath`で解決済み）
     * @returns 固定したディレクトリ（`descriptorPath`は`logicalPath`と同じ）
     */
    private async openPathPinnedDirectory(logicalPath: string, boundary: string): Promise<PinnedUploadDirectory> {
        let stats: Stats;
        try {
            stats = await (this.uploadFileSystem ?? uploadFileSystem).lstat(logicalPath);
        } catch (error) {
            const code = fileSystemErrorCode(error);
            if (code === 'ENOENT' || code === 'ENOTDIR') {
                throw new Error('UploadPathError', { cause: error });
            }
            throw error;
        }
        if (!stats.isDirectory()) {
            throw new Error('UploadPathError');
        }
        const directory = new PinnedUploadDirectory(
            logicalPath,
            logicalPath,
            { dev: stats.dev, ino: stats.ino },
            pathOnlyHandle,
            boundary,
        );
        await this.assertPinnedUploadDirectory(directory);
        return directory;
    }

    /**
     * Linux以外でだけ、ディレクトリへの操作（削除・作成）の直前にrootから対象の親までを確認し直す。
     * Linuxはfile descriptorで固定済みのため何もしない。
     * @param directory 操作先として固定したディレクトリ
     */
    private async confirmDirectoryBeforeMutation(directory: PinnedUploadDirectory): Promise<void> {
        if (!this.usesDescriptorPaths()) {
            await this.assertPinnedUploadDirectory(directory);
        }
    }

    /**
     * `boundary`から`directory`までの各階層のpath（`boundary`自身を含む）を返す。`directory`が
     * `boundary`の外（`..`で出る・別のdriveなど）なら`undefined`を返す。
     * @param boundary 保存先root
     * @param directory 対象のディレクトリ
     * @param platformPath path操作に使うplatform（既定は実行中のplatform）
     * @returns `boundary`から`directory`までの各階層のpath、または`undefined`
     */
    private getPathChain(
        boundary: string,
        directory: string,
        platformPath: Pick<path.PlatformPath, 'isAbsolute' | 'join' | 'relative' | 'sep'> = path,
    ): string[] | undefined {
        const relative = platformPath.relative(boundary, directory);
        if (relative === '..' || relative.startsWith(`..${platformPath.sep}`) || platformPath.isAbsolute(relative)) {
            return undefined;
        }
        const chain = [boundary];
        for (const segment of relative.split(platformPath.sep).filter(value => value.length > 0)) {
            chain.push(platformPath.join(chain[chain.length - 1], segment));
        }
        return chain;
    }

    /**
     * Linux以外で、`boundary`から`directory`までの各階層が（`lstat`で）symbolic linkではない
     * ディレクトリであり、`directory`の`realpath`が`boundary`の`realpath`の中にあることを確認する。
     * @param directory 確認するディレクトリ
     */
    private async assertPathChain(directory: PinnedUploadDirectory): Promise<void> {
        const fileSystem = this.uploadFileSystem ?? uploadFileSystem;
        const chain = this.getPathChain(directory.boundary, directory.logicalPath);
        if (typeof chain === 'undefined') {
            throw new Error('UploadPathError');
        }
        try {
            for (const component of chain) {
                if (!(await fileSystem.lstat(component)).isDirectory()) {
                    throw new Error('UploadPathError');
                }
            }
            const [boundaryRealPath, directoryRealPath] = await Promise.all([
                fileSystem.realpath(directory.boundary),
                fileSystem.realpath(directory.logicalPath),
            ]);
            if (typeof this.getPathChain(boundaryRealPath, directoryRealPath) === 'undefined') {
                throw new Error('UploadPathError');
            }
        } catch {
            throw new Error('UploadPathError');
        }
    }

    private async assertPinnedUploadDirectory(directory: PinnedUploadDirectory): Promise<void> {
        const fileSystem = this.uploadFileSystem ?? uploadFileSystem;
        let descriptorStats: Stats;
        let logicalStats: Stats;
        try {
            [descriptorStats, logicalStats] = await Promise.all([
                fileSystem.stat(directory.descriptorPath),
                fileSystem.lstat(directory.logicalPath),
            ]);
        } catch {
            throw new Error('UploadPathError');
        }
        if (
            !descriptorStats.isDirectory() ||
            !logicalStats.isDirectory() ||
            descriptorStats.dev !== directory.identity.dev ||
            descriptorStats.ino !== directory.identity.ino ||
            logicalStats.dev !== directory.identity.dev ||
            logicalStats.ino !== directory.identity.ino
        ) {
            throw new Error('UploadPathError');
        }
        if (!this.usesDescriptorPaths()) {
            await this.assertPathChain(directory);
        }
    }

    private async placeUploadedFile(
        source: string,
        directory: PinnedUploadDirectory,
        fileName: string,
        cleanup: UploadOwnerCleanup,
    ): Promise<PlacedUploadFile> {
        if (
            fileName.length === 0 ||
            fileName === '.' ||
            fileName === '..' ||
            fileName.includes('/') ||
            fileName.includes('\\')
        ) {
            throw new Error('UploadPathError');
        }
        const extname = path.extname(fileName);
        const name = fileName.slice(0, fileName.length - extname.length);
        const extensionBytes = Buffer.byteLength(extname);
        for (let conflict = 0; conflict < uploadCandidateLimit; conflict += 1) {
            const count = conflict > 0 ? `(${conflict})` : '';
            const maximumStemBytes = uploadNameMaxBytes - Buffer.byteLength(count) - extensionBytes;
            if (maximumStemBytes < 0) {
                throw new Error('UploadPathError');
            }
            const stem = this.truncateUploadName(name, maximumStemBytes);
            const candidateName = `${stem}${count}${extname}`;
            const descriptorCandidate = path.join(directory.descriptorPath, candidateName);
            await this.confirmDirectoryBeforeMutation(directory);
            if (!(await this.createUploadCandidate(source, descriptorCandidate, cleanup, directory))) {
                continue;
            }
            try {
                await this.assertPinnedUploadDirectory(directory);
                await cleanup.remove(source);
                await this.assertPinnedUploadDirectory(directory);
            } catch (error) {
                await this.cleanUploadCandidate(directory, cleanup, descriptorCandidate);
                if (error instanceof Error && error.message === 'UploadPathError') {
                    throw error;
                }
                throw new Error('FileMoveError', { cause: error });
            }
            return {
                directory,
                descriptorPath: descriptorCandidate,
                logicalPath: path.join(directory.logicalPath, candidateName),
            };
        }
        throw new Error('UploadCandidateLimitError');
    }

    /**
     * 配置先に作った候補を後始末で消す。Linux以外では実pathを指定して消すため、消す前に配置先を
     * 確認し直し、差し替えを見つけたら消さずにlogへ残す（link先の保存先外の同名fileを消さないため）。
     * @param directory 候補を作った配置先
     * @param cleanup 後始末の削除試行の重複防止
     * @param candidate 消す候補のpath
     */
    private async cleanUploadCandidate(
        directory: PinnedUploadDirectory,
        cleanup: UploadOwnerCleanup,
        candidate: string,
    ): Promise<void> {
        try {
            await this.confirmDirectoryBeforeMutation(directory);
        } catch (error) {
            this.log.system.error(`skipped cleanup of an unverified upload path: ${candidate}`);
            this.log.system.error(error);
            return;
        }
        await cleanup.bestEffort(candidate);
    }

    private truncateUploadName(value: string, maximumBytes: number): string {
        let result = '';
        let byteLength = 0;
        for (const character of value) {
            const characterBytes = Buffer.byteLength(character);
            if (byteLength + characterBytes > maximumBytes) {
                break;
            }
            result += character;
            byteLength += characterBytes;
        }
        return result;
    }

    private async createUploadCandidate(
        source: string,
        candidate: string,
        cleanup: UploadOwnerCleanup,
        directory: PinnedUploadDirectory,
    ): Promise<boolean> {
        const fileSystem = this.uploadFileSystem ?? uploadFileSystem;
        try {
            await fileSystem.link(source, candidate);
            return true;
        } catch (error) {
            if (fileSystemErrorCode(error) === 'EEXIST') {
                return false;
            }
            if (fileSystemErrorCode(error) !== 'EXDEV') {
                throw new Error('FileMoveError', { cause: error });
            }
        }
        try {
            await fileSystem.copyFile(source, candidate, fsConstants.COPYFILE_EXCL);
        } catch (error) {
            if (fileSystemErrorCode(error) === 'EEXIST') {
                return false;
            }
            await this.cleanUploadCandidate(directory, cleanup, candidate);
            throw new Error('FileMoveError', { cause: error });
        }
        return true;
    }

    private async cleanAdoptedDirectory(filePath: string): Promise<void> {
        const tokenDirectory = path.dirname(filePath);
        if (path.basename(filePath) !== 'payload' || path.basename(path.dirname(tokenDirectory)) !== 'adopted') {
            return;
        }
        await (this.uploadFileSystem ?? uploadFileSystem).rmdir(tokenDirectory).catch(() => undefined);
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        this.log.system.info('create new recorded');

        const recorded = new Recorded();
        recorded.isRecording = false;
        recorded.isProtected = false;
        if (typeof option.ruleId !== 'undefined') {
            recorded.ruleId = option.ruleId;
        }
        recorded.channelId = option.channelId;
        recorded.startAt = option.startAt;
        recorded.endAt = option.endAt;
        if (option.startAt - option.endAt >= 0) {
            throw new Error('TimeRangeError');
        }
        recorded.duration = option.endAt - option.startAt;
        recorded.name = StrUtil.toDBStr(option.name);
        recorded.halfWidthName = StrUtil.toHalf(option.name);
        if (typeof option.description !== 'undefined') {
            recorded.description = StrUtil.toDBStr(option.description);
            recorded.halfWidthDescription = StrUtil.toHalf(recorded.description);
        }
        if (typeof option.extended !== 'undefined') {
            recorded.extended = StrUtil.toDBStr(option.extended);
            recorded.halfWidthExtended = StrUtil.toHalf(recorded.extended);
        }
        if (typeof option.genre1 !== 'undefined') {
            recorded.genre1 = option.genre1;
        }
        if (typeof option.subGenre1 !== 'undefined') {
            recorded.subGenre1 = option.subGenre1;
        }
        if (typeof option.genre2 !== 'undefined') {
            recorded.genre2 = option.genre2;
        }
        if (typeof option.subGenre2 !== 'undefined') {
            recorded.subGenre2 = option.subGenre2;
        }
        if (typeof option.genre3 !== 'undefined') {
            recorded.genre3 = option.genre3;
        }
        if (typeof option.subGenre3 !== 'undefined') {
            recorded.subGenre3 = option.subGenre3;
        }

        const recordedId = await this.recordedDB.insertOnce(recorded).catch(err => {
            this.log.system.error(err);
            throw err;
        });

        this.log.system.info(`created new recorded: ${recordedId}`);

        this.recordedEvent.emitCreateNewRecorded(recordedId);

        return recordedId;
    }

    /**
     * 指定された video file id のファイルを削除する
     * @param videoFileid: apid.VideoFileId
     * @param isIgnoreProtection: boolean
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileid: apid.VideoFileId, isIgnoreProtection: boolean = false): Promise<void> {
        this.log.system.info(`delete video file: ${videoFileid}`);

        const video = await this.videoFileDB.findId(videoFileid);
        if (video === null) {
            this.log.system.info(`video file is not found: ${videoFileid}`);
            throw new Error('VideoFileIsNotFound');
        }

        // プロテクトがかかっているか確認
        let recorded = await this.recordedDB.findId(video.recordedId);
        if (isIgnoreProtection === false && recorded !== null && recorded.isProtected === true) {
            this.log.system.warn(`${videoFileid} is protected`);
            throw new Error('RecordedIsProtected');
        }

        // 録画中の場合は録画情報ごと削除
        if (recorded?.isRecording === true) {
            return await this.delete(video.recordedId, false);
        }

        // 実ファイル削除
        await this.removeManagedFile(this.getVideoFileRoot(video.parentDirectoryName), video.filePath);

        // DB から削除
        await this.videoFileDB.deleteOnce(videoFileid);

        // video に紐付けられていた recorded が空かチェック
        recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded !== null && typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length === 0) {
            // 空だったので recorded も削除
            this.log.system.info(`empty video files: ${video.recordedId}`);
            await this.delete(video.recordedId, false);
        } else {
            this.recordedEvent.emitDeleteVideoFile(videoFileid);
        }
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public async changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        this.log.system.info((isProtect === true ? 'set protect' : 'remove protect') + `: ${recordedId}`);

        await this.recordedDB.changeProtect(recordedId, isProtect);
        this.recordedEvent.emitChangeProtect(recordedId, isProtect);
    }

    /**
     * RecordedHistory の保存期間外のデータを削除する
     * @return Promise<void>
     */
    public async historyCleanup(): Promise<void> {
        const date = new Date().getTime() - this.config.recordedHistoryRetentionPeriodDays * 24 * 60 * 60 * 1000;
        await this.recordedHistoryDB.delete(date).catch(err => {
            this.log.system.error('failed to historyCleanup');
            this.log.system.error(err);
        });
    }

    /**
     * DB に登録されていない recorded 下のファイル削除 &  DB に登録されているが存在しない番組情報の削除
     * @return Promise<void>
     */
    public async videoFileCleanup(): Promise<void> {
        if (this.videoFileCleanupState === 'running') {
            throw new Error('VideoFileCleanupIsRunning');
        }
        this.videoFileCleanupState = 'running';

        try {
            await this.executeVideoFileCleanup();
        } finally {
            this.videoFileCleanupState = 'idle';
        }
    }

    private async executeVideoFileCleanup(): Promise<void> {
        this.log.system.info('start video files cleanup');

        const videoFiles = await this.videoFileDB.findAll();

        // ファイル, ディレクトリ索引生成と DB 上に存在するが実ファイルが存在しないデータを削除する
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        const dirIndex: { [dirPath: string]: boolean } = {}; // ディレクトリ索引
        for (const video of videoFiles) {
            const videoFilePath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (videoFilePath === null) {
                continue;
            }

            if ((await this.checkFileExistence(videoFilePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[videoFilePath] = true;
                const parentDir = path.dirname(videoFilePath).replace(new RegExp(`\\${path.sep}$`), '');
                dirIndex[parentDir] = true;
            } else {
                // ファイルが存在しないなら削除
                await this.deleteVideoFile(video.id).catch(() => {});
            }
        }

        // 実ファイルリストを取得する
        const list: FileUtil.FileList = {
            files: [],
            directories: [],
        };
        const managedRoots: Array<{ identity: FileUtil.ManagedRootIdentity; path: string }> = [];
        for (const r of this.config.recorded) {
            const identity = FileUtil.captureManagedRootIdentity(r.path);
            const l = await FileUtil.getFileList(r.path);
            Array.prototype.push.apply(list.files, l.files);
            Array.prototype.push.apply(list.directories, l.directories);
            managedRoots.push({ identity, path: r.path });
            dirIndex[r.path] = true; // 親ディレクトリを索引に追加
        }
        // ディレクトリ削除時にネストが深いディレクトリから削除するためにソート
        list.directories.sort((dir1, dir2) => {
            return dir2.length - dir1.length;
        });

        // ファイル索引上に存在しないファイルを削除する
        for (const file of list.files) {
            if (typeof fileIndex[file] !== 'undefined') {
                continue;
            }

            if (
                managedRoots.some(root => FileUtil.isManagedEntrySafeForRemoval(root.path, file, root.identity)) ===
                false
            ) {
                this.log.system.error(`refused unsafe cleanup file: ${file}`);
                continue;
            }

            this.log.system.info(`delete file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to delete file: ${file}`);
                this.log.system.error(err);
            });
        }

        // ディレクトリ索引上に存在しないディレクトリを削除する
        for (const dir of list.directories) {
            if (typeof dirIndex[dir] !== 'undefined') {
                continue;
            }

            if (
                managedRoots.some(root =>
                    FileUtil.isManagedEntrySafeForRemoval(root.path, dir, root.identity, true),
                ) === false
            ) {
                this.log.system.error(`refused unsafe cleanup directory: ${dir}`);
                continue;
            }

            this.log.system.info(`delete directory: ${dir}`);
            try {
                // ディレクトリが空かチェック
                if ((await FileUtil.isEmptyDirectory(dir)) === true) {
                    await FileUtil.rmdir(dir);
                } else {
                    this.log.system.warn(`directory is not empty: ${dir}`);
                }
            } catch (err: any) {
                this.log.system.error(`failed to delete directory: ${dir}`);
                this.log.system.error(err);
            }
        }

        this.log.system.info('start video files cleanup completed');
    }

    /**
     * DB に登録されていないログファイル削除 &  DB に登録されているが存在しないログ情報の削除
     */
    public async dropLogFileCleanup(): Promise<void> {
        if (this.dropLogFileCleanupState === 'running') {
            throw new Error('DropLogFileCleanupIsRunning');
        }
        this.dropLogFileCleanupState = 'running';

        try {
            await this.executeDropLogFileCleanup();
        } finally {
            this.dropLogFileCleanupState = 'idle';
        }
    }

    private async executeDropLogFileCleanup(): Promise<void> {
        this.log.system.info('start drop log files cleanup');
        const dropLogs = await this.dropLogFileDB.findAll();

        // ファイル, ディレクトリ索引生成と DB 上に存在するが実ファイルが存在しないデータを削除する
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        for (const dropLog of dropLogs) {
            const filePath = this.getDropLogFilePath(dropLog);

            if ((await this.checkFileExistence(filePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[filePath] = true;
            } else {
                this.log.system.warn(`drop file is not exist: ${filePath}`);
                // ファイルが存在しないなら削除
                let relationChanged = false;
                let rowDeleted = false;
                try {
                    relationChanged = await this.recordedDB.removeDropLogFileId(dropLog.id);
                    rowDeleted = await this.dropLogFileDB.deleteOnce(dropLog.id);
                } catch (err: any) {
                    this.log.system.error(err);
                }
                if (relationChanged === true || rowDeleted === true) {
                    this.recordedEvent.emitDropLogFileChanged(dropLog.id);
                }
            }
        }

        // ファイル索引上に存在しないファイルを削除する
        const managedRootIdentity = FileUtil.captureManagedRootIdentity(this.config.dropLog);
        const list = await FileUtil.getFileList(this.config.dropLog);
        for (const file of list.files) {
            if (typeof fileIndex[file] !== 'undefined') {
                continue;
            }

            if (FileUtil.isManagedEntrySafeForRemoval(this.config.dropLog, file, managedRootIdentity) === false) {
                this.log.system.error(`refused unsafe drop log cleanup file: ${file}`);
                continue;
            }

            this.log.system.info(`delete drop log file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to drop log file: ${file}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info('start drop log files cleanup completed');
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

    /**
     * 指定された ruleId を録画情報から削除する
     * @param ruleId: apid.Rule
     */
    public async removeRuleId(ruleId: apid.RuleId): Promise<void> {
        await this.recordedDB.removeRuleId(ruleId);
    }
}
