import { open } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { inject, injectable, unmanaged } from 'inversify';
import { Readable } from 'stream';

import IVideoUtil, { VideoInfo } from '../../api/video/IVideoUtil.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IRecordedPlaybackSourceProvider, {
    OpenedRecordedPlaybackSource,
    RecordedPlaybackOpenOption,
    RecordedPlaybackReader,
    RecordedPlaybackReaderFactory,
    RecordedPlaybackSource,
    RecordedPlaybackSourceAdoption,
} from './IRecordedPlaybackSourceProvider.js';

/**
 * 録画中（末尾がまだ書き込まれ続けている）fileを、末尾に達してもEOFとして終了せず、
 * fileが成長し続ける限り読み進める`Readable`。通常の`fs.createReadStream`は現在のfile長で
 * 止まってしまうため、録画中の再生用にこのclassが必要になる。
 */
class RecordingTailReadable extends Readable {
    /** file成長待ちの間だけ張るtimer（`checkFile`で開始、成長を検知したら`readBytes`が再開しclearする）。 */
    private checkFileTimer: NodeJS.Timeout | null = null;
    /** 次に読み始める読み取り位置（byte offset）。読み進めるたびに進む。 */
    private offset: number;
    /** 読み取り処理が実行中かどうか。`_read`の再入（Node側から重ねて呼ばれること）を防ぐ。 */
    private readInProgress = false;

    constructor(
        private readonly file: FileHandle,
        start: number,
    ) {
        super();
        this.offset = start;
    }

    public _read(size: number): void {
        if (this.destroyed || this.readInProgress) {
            return;
        }

        this.clearFileTimer();
        void this.readBytes(size);
    }

    public _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this.clearFileTimer();
        void this.file.close().then(
            () => callback(error),
            (closeError: Error) => callback(error ?? closeError),
        );
    }

    private async readBytes(size: number): Promise<void> {
        this.readInProgress = true;
        try {
            const stat = await this.file.stat();
            if (this.destroyed) {
                return;
            }

            const start = stat.size < this.offset ? 0 : this.offset;
            const bytesToRead = Math.min(size, stat.size - start);
            const buffer = Buffer.allocUnsafe(bytesToRead);
            const { bytesRead } = await this.file.read(buffer, 0, bytesToRead, start);
            if (this.destroyed) {
                return;
            }
            if (bytesRead === 0) {
                this.checkFile(size, stat.size);
                return;
            }

            this.offset = start + bytesRead;
            this.push(buffer.subarray(0, bytesRead));
        } catch (error) {
            this.destroy(error as Error);
        } finally {
            this.readInProgress = false;
        }
    }

    private checkFile(size: number, previousSize: number): void {
        this.checkFileTimer = setTimeout(() => {
            this.checkFileTimer = null;
            void this.checkForGrowth(size, previousSize);
        }, 1000);
    }

    private async checkForGrowth(size: number, previousSize: number): Promise<void> {
        try {
            const stat = await this.file.stat();
            if (this.destroyed) {
                return;
            }
            if (stat.size !== previousSize) {
                void this.readBytes(size);
                return;
            }

            this.push(null);
        } catch (error) {
            this.destroy(error as Error);
        }
    }

    private clearFileTimer(): void {
        clearTimeout(this.checkFileTimer ?? undefined);
        this.checkFileTimer = null;
    }
}

const closeableReader = (readable: Readable): RecordedPlaybackReader => {
    let closed: Promise<void> | null = null;

    return {
        close: (): Promise<void> => {
            closed ??= readable.closed
                ? Promise.resolve()
                : new Promise<void>(resolve => {
                      readable.once('close', resolve);
                      readable.destroy();
                  });
            return closed;
        },
        readable,
    };
};

/** `RecordedPlaybackReaderFactory`の既定実装。実際にNode.jsの`fs`でfileを開く。 */
class NodeRecordedPlaybackReaderFactory implements RecordedPlaybackReaderFactory {
    public async openRecordingTail(inputPath: string, start: number): Promise<RecordedPlaybackReader> {
        const file = await open(inputPath, 'r');
        return closeableReader(new RecordingTailReadable(file, start));
    }

    public async openCompletedFile(inputPath: string, start: number): Promise<RecordedPlaybackReader> {
        const file = await open(inputPath, 'r');
        try {
            return closeableReader(file.createReadStream({ start }));
        } catch (error) {
            // 後始末の失敗が、readerを作れなかった元のerrorを隠さないようにする。
            await file.close().catch(() => undefined);
            throw error;
        }
    }
}

/**
 * `open`が返す、まだ呼び出し側に「採用（adopt）」されていない再生sourceのラッパー。
 * 呼び出し側が結局使わなかった場合に備え、採用される前に破棄できる経路（`disposeBeforeAdoption`）を持つ。
 * `adopt`と`disposeBeforeAdoption`は状態を1回だけ`pending`から遷移させ、以後の呼び出しは
 * 実質的に無視する（二重adopt・二重disposeを安全にする）。
 */
class OpenedPlaybackSource implements OpenedRecordedPlaybackSource {
    /** `disposeBeforeAdoption`の結果Promise。破棄開始後の再呼び出しはこれをそのまま返す。 */
    private disposal: Promise<void> | null = null;
    /** `pending`（未確定）→`adopted`（採用済み）または`disposed`（破棄済み）の一方向遷移。 */
    private playbackState: 'pending' | 'adopted' | 'disposed' = 'pending';

    constructor(private readonly source: RecordedPlaybackSource) {}

    public get state(): 'pending' | 'adopted' | 'disposed' {
        return this.playbackState;
    }

    public adopt(): RecordedPlaybackSourceAdoption {
        if (this.playbackState !== 'pending') {
            return { status: 'stale' };
        }

        this.playbackState = 'adopted';
        return { source: this.source, status: 'adopted' };
    }

    public disposeBeforeAdoption(): Promise<void> {
        if (this.playbackState !== 'pending') {
            return this.disposal ?? Promise.resolve();
        }

        this.playbackState = 'disposed';
        this.disposal = this.source.kind === 'encoded-direct' ? Promise.resolve() : this.source.reader.close();
        return this.disposal;
    }
}

/**
 * `IRecordedPlaybackSourceProvider`の実装。ビデオファイルの種別（encode済み/未encode）と、
 * 録画が進行中かどうかに応じて、`IRecordedPlaybackSourceProvider.ts`で定義される3種の
 * 読み取り方法（`encoded-direct`/`recording-tail-reader`/`completed-file-reader`）のいずれかを選ぶ。
 */
@injectable()
export default class RecordedPlaybackSourceProvider implements IRecordedPlaybackSourceProvider {
    /**
     * @param videoFileDB ビデオファイル情報の検索に使う。
     * @param recordedDB 録画情報（録画中かどうか等）の検索に使う。
     * @param videoUtil 実file pathの解決と、bitrate等のvideo情報取得に使う。
     * @param readerFactory 録画中/完了済みfileそれぞれの読み取りreaderを作る工場。test時に差し替える。
     */
    constructor(
        @inject('IVideoFileDB') private readonly videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') private readonly recordedDB: IRecordedDB,
        @inject('IVideoUtil') private readonly videoUtil: IVideoUtil,
        @unmanaged() readerFactory: RecordedPlaybackReaderFactory = new NodeRecordedPlaybackReaderFactory(),
    ) {
        this.readerFactory = readerFactory;
    }

    /** 録画中file用・完了済みfile用のreaderをそれぞれ作る工場（既定は`NodeRecordedPlaybackReaderFactory`）。 */
    private readonly readerFactory: RecordedPlaybackReaderFactory;

    /**
     * ビデオファイルIDから、それが属する録画情報のIDを引く。
     * @param videoFileId 対象のビデオファイルID。
     * @returns 対応する録画情報ID。
     * @throws 対象のビデオファイルが存在しない場合。
     */
    public async resolveRecordedId(videoFileId: number): Promise<number> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('RecordedPlaybackVideoFileNotFound');
        }

        return videoFile.recordedId;
    }

    /**
     * 指定ビデオファイルの再生sourceを開く。ビデオファイルが未encode（`type !== 'encoded'`）の場合、
     * 録画情報の`isRecording`に応じて`recording-tail-reader`（録画中、成長を追い続ける）または
     * `completed-file-reader`（完了済み、通常のfile読み取り）を選ぶ。
     * @param videoFileId 対象のビデオファイルID。
     * @param expectedRecordedId 呼び出し側が前提としている録画情報ID（`videoFileId`との対応を検証する）。
     * @param playPosition 再生開始位置（0〜1の割合。bitrateから概算のbyte offsetへ変換する）。
     * @param option `allowMissingVideoInfo`が`true`なら、動画情報の取得に失敗しても`NaN`の動画情報で続ける（直接配信用）。
     * @returns 開いた再生source（採用前に破棄可能な状態で返る）。
     * @throws ビデオファイル・録画情報が存在しない、`expectedRecordedId`と食い違う、
     *         実file pathが解決できない場合。bitrateが取れず（有限でなく）、0を超える`playPosition`の
     *         開始位置を概算できない場合は`RecordedPlaybackStartPositionUnavailable`。
     */
    public async open(
        videoFileId: number,
        expectedRecordedId: number,
        playPosition: number,
        option?: RecordedPlaybackOpenOption,
    ): Promise<OpenedRecordedPlaybackSource> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('RecordedPlaybackVideoFileNotFound');
        }
        if (videoFile.recordedId !== expectedRecordedId) {
            throw new Error('RecordedPlaybackRecordedIdMismatch');
        }

        const recorded = await this.recordedDB.findId(videoFile.recordedId);
        if (recorded === null) {
            throw new Error('RecordedPlaybackRecordedNotFound');
        }
        if (recorded.id !== expectedRecordedId) {
            throw new Error('RecordedPlaybackRecordedIdMismatch');
        }

        const inputPath = this.videoUtil.getFullFilePathFromVideoFile(videoFile);
        if (inputPath === null) {
            throw new Error('RecordedPlaybackPathNotFound');
        }

        let videoInfo: VideoInfo;
        try {
            videoInfo = await this.videoUtil.getInfo(inputPath);
        } catch (error: unknown) {
            // 動画情報を使わない直接配信では、取得の失敗（外部処理の起動行や実pathを含む文言）を呼び出し元へ伝えない。
            if (option?.allowMissingVideoInfo !== true) {
                throw error;
            }
            videoInfo = { bitRate: Number.NaN, duration: Number.NaN, size: Number.NaN };
        }
        if (videoFile.type === 'encoded') {
            return new OpenedPlaybackSource({
                inputPath,
                kind: 'encoded-direct',
                playPosition,
                recordedId: videoFile.recordedId,
                videoFileId: videoFile.id,
                videoInfo,
            });
        }

        // 再生位置0は常にfile先頭から読む。ffprobeが`bit_rate`を返さず`bitRate`が`NaN`でも、
        // `NaN * 0`で開始位置を壊さない。0を超える位置はbitrateから概算するため、概算できなければreaderを開かず失敗する。
        const start = playPosition === 0 ? 0 : Math.floor((videoInfo.bitRate / 8) * playPosition);
        if (Number.isFinite(start) === false) {
            throw new Error('RecordedPlaybackStartPositionUnavailable');
        }
        const reader = recorded.isRecording
            ? await this.readerFactory.openRecordingTail(inputPath, start)
            : await this.readerFactory.openCompletedFile(inputPath, start);
        return new OpenedPlaybackSource({
            inputPath,
            kind: recorded.isRecording ? 'recording-tail-reader' : 'completed-file-reader',
            playPosition,
            reader,
            recordedId: videoFile.recordedId,
            videoFileId: videoFile.id,
            videoInfo,
        });
    }
}
