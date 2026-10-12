import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import internal, { Readable } from 'stream';
// CommonJS package のため、既定の書き出しは名前空間の default に入る。
import aribSubtitleTimedmetadater from 'arib-subtitle-timedmetadater';

const ID3MetadataTransform = aribSubtitleTimedmetadater.default;
type ID3MetadataTransform = InstanceType<typeof ID3MetadataTransform>;
import type * as apid from '../../../../../api.js';
import * as fst from '../../../../lib/TailStream.js';
import ProcessUtil from '../../../../util/ProcessUtil.js';
import IVideoUtil from '../../../api/video/IVideoUtil.js';
import IRecordedDB from '../../../db/IRecordedDB.js';
import IVideoFileDB from '../../../db/IVideoFileDB.js';
import IConfiguration from '../../../IConfiguration.js';
import ILoggerModel from '../../../ILoggerModel.js';
import {
    RecordedPlaybackReader,
    RecordedPlaybackSource,
} from '../../../operator/recorded/IRecordedPlaybackSourceProvider.js';
import IEncodeProcessManageModel, {
    CreateProcessOption,
    HlsWriterHandle,
    HlsWriterStopResult,
    ManagedProcessHandle,
} from '../../encode/IEncodeProcessManageModel.js';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel.js';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel.js';
import RecordedPlaybackSourceConsumer, {
    ConsumedRecordedPlaybackSource,
} from '../recorded/RecordedPlaybackSourceConsumer.js';
import IRecordedStreamBaseModel, { RecordedStreamOption, VideoFileInfo } from './IRecordedStreamBaseModel.js';
import { RecordedStreamInfo } from './IStreamBaseModel.js';
import StreamBaseModel, { HlsStopFinalization } from './StreamBaseModel.js';

const createEncodeProcessLogMessage = (command: string): string => `create encode process: ${command}`;
const createEncodeProcessFailureLogMessage = (command: string): string => `create encode process failed: ${command}`;

/**
 * 録画済みファイルの `StreamBaseModel` 実装。ファイル読み出し（またはリースされた
 * playback source）を入力とし、必要であればエンコードプロセスへパイプ接続する。
 *
 * `LiveStreamBaseModel` の `LiveStartSession` オブジェクトによる世代管理とは異なり、
 * こちらは `processStartGeneration`（世代トークン）と、世代ごとの「まだ完了していない
 * 非同期処理」を種類別の `Set`/`WeakSet`/`WeakMap` で追跡する形を取る。`stop()` は
 * 世代ごとに一度しか実行されないよう、世代トークンをキーにした `stopOperations` で
 * 結果を再利用する。
 */
@injectable()
export default abstract class RecordedStreamBaseModel
    extends StreamBaseModel<RecordedStreamOption>
    implements IRecordedStreamBaseModel
{
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;

    /** 録画済みファイルを直接読む場合の読み出し stream（配信元が playback source 経由でない場合）。 */
    private fileStream: Readable | null = null;
    /** playback source（リース経由）から取得した読み出し reader。`encoded-direct`種別では無い。 */
    private sourceReader: RecordedPlaybackReader | null = null;
    private id3MetadataTransoform: ID3MetadataTransform | null = null;
    private streamProcess: ChildProcess | null = null;
    private streamProcessHandle: ManagedProcessHandle | null = null;
    private hlsWriterHandle: HlsWriterHandle | null = null;
    /**
     * 現在進行中の `start()` 呼び出しの世代を表すトークン。`stop()`/`stopInternal`は
     * このトークンをキーに、世代ごとに独立した後始末・停止済み判定を行う。
     */
    private processStartGeneration?: object;
    /** まだ`finishProcessStartGeneration`されていない、起動処理が進行中の世代の集合。 */
    private readonly pendingProcessStartGenerations: Set<object> = new Set();
    /** `stopSession`相当（この class では`stopInternal`）で停止済みと記録された世代の集合。 */
    private stoppedProcessStartGenerations: WeakSet<object> = new WeakSet();
    /** managed process（非HLS）の終了をまだ観測できていない Promise の集合。playback source 解放を遅延させる条件の1つ。 */
    private readonly pendingManagedProcessTerminals: Set<Promise<void>> = new Set();
    /** `stopHlsWriterAndReleaseWhenSafe`実行中の finalization の集合（現状は追跡専用で判定には未使用）。 */
    private readonly pendingHlsWriterStops: Set<HlsStopFinalization> = new Set();
    /** 起動が完了し、まだ停止していない HLS writer の finalization の集合。playback source 解放を遅延させる条件の1つ。 */
    private readonly activeHlsWriterFinalizations: Set<HlsStopFinalization> = new Set();
    private videoFilePath: string | null = null;
    private videoFileInfo: VideoFileInfo | null = null;
    private videoFileType: apid.VideoFileType = 'encoded';
    /** 対象の録画が録画中（末尾が伸び続けている）かどうか。ファイル読み出し方式の選択に使う。 */
    private isRecording: boolean = false;
    /** `adoptPlaybackSource`で受け取った、正規化済みの配信元。DBから取得する経路では null のまま。 */
    private playbackSource: ConsumedRecordedPlaybackSource | null = null;
    /** `playbackSource`と対になる解放処理。停止時にまだ安全に呼べない場合は`deferredPlaybackSourceRelease`へ移す。 */
    private playbackSourceRelease: (() => Promise<void>) | null = null;
    /** 停止処理の中で退避された、まだ実行されていない playback source 解放処理。 */
    private deferredPlaybackSourceRelease: (() => Promise<void>) | null = null;
    private readonly playbackSourceConsumer = new RecordedPlaybackSourceConsumer();
    /** 世代トークンごとの`stop()`結果。同一世代からの複数回`stop()`呼び出しを1回にまとめる。 */
    private readonly stopOperations: WeakMap<object, Promise<void>> = new WeakMap();
    /** `processStartGeneration`が未確定（`start()`未実施）の状態で`stop()`が呼ばれた場合の結果のキャッシュ。 */
    private stopOperationWithoutGeneration: Promise<void> | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        super(configure, logger, processManager, fileDeleter, socketIO);

        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
    }

    /**
     * ストリーム開始。動画情報の取得・（必要なら）HLSディレクトリ準備・ファイル読み出し
     * stream の生成・エンコードプロセス起動を順に行う。`processStartGeneration`で
     * この呼び出し自身の世代を識別し、各段階の後で世代が変わっていないか
     * （＝この呼び出しの途中で`stop()`や次の`start()`が来ていないか）を確認しながら進める。
     * @param streamId 配信の識別子。HLSの場合は出力ファイル名にも使われる。
     */
    public async start(streamId: apid.StreamId): Promise<void> {
        const processStartGeneration = {};
        this.processStartGeneration = processStartGeneration;
        let hlsStopFinalization: HlsStopFinalization | null = null;

        // HLS stream ディレクトリ使用準備
        if (this.getStreamType() === 'RecordedHLS') {
            try {
                hlsStopFinalization = await this.prepStreamDir(streamId);
            } catch (error) {
                await this.stop();
                throw error;
            }
        }

        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        await this.setVideFileInfo();
        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        // 開始時刻が動画の長さを超えている
        if (this.processOption.playPosition > this.videoFileInfo.duration) {
            await this.stop();
            throw new Error('OutOfRange');
        }

        // file read stream の生成
        try {
            this.setFileStream();
        } catch (err: any) {
            this.log.stream.error('create file stream error');
            this.log.stream.error(err);
            await this.stop();
            throw new Error('FileStreamSetError', { cause: err });
        }

        // エンコードプロセス生成
        const poption = await this.createProcessOption(streamId);
        if (
            this.stoppedProcessStartGenerations.has(processStartGeneration) ||
            this.processStartGeneration !== processStartGeneration
        ) {
            return;
        }
        this.pendingProcessStartGenerations.add(processStartGeneration);
        this.log.stream.info(createEncodeProcessLogMessage(poption.cmd));
        try {
            if (this.getStreamType() === 'RecordedHLS') {
                const finalization = hlsStopFinalization!;
                this.beginHlsWriterStart(finalization);
                const result = await this.processManager.createHlsWriter(poption);
                if (
                    this.stoppedProcessStartGenerations.has(processStartGeneration) ||
                    this.processStartGeneration !== processStartGeneration
                ) {
                    await this.stopLateHlsWriterAndCleanupArtifacts(finalization, () =>
                        this.processManager.stopHls(result.handle),
                    );
                    return;
                }
                this.activeHlsWriterFinalizations.add(finalization);
                this.completeHlsWriterStart(finalization);
                this.streamProcess = result.child;
                this.hlsWriterHandle = result.handle;
            } else {
                const result = await this.processManager.createManaged(poption);
                this.observeManagedProcessTerminal(result.child);
                if (
                    this.stoppedProcessStartGenerations.has(processStartGeneration) ||
                    this.processStartGeneration !== processStartGeneration
                ) {
                    await this.processManager.requestStop(result.handle);
                    return;
                }
                this.streamProcess = result.child;
                this.streamProcessHandle = result.handle;
            }
        } catch (err: any) {
            if (hlsStopFinalization !== null) {
                this.completeHlsWriterStart(hlsStopFinalization);
            }
            if (
                this.stoppedProcessStartGenerations.has(processStartGeneration) ||
                this.processStartGeneration !== processStartGeneration
            ) {
                throw err;
            }

            this.log.stream.error(createEncodeProcessFailureLogMessage(poption.cmd));
            await this.stop();
        } finally {
            this.finishProcessStartGeneration(processStartGeneration);
        }
        if (this.streamProcess === null) {
            throw new Error('CreateStreamProcessError');
        }

        // process 終了時にイベントを発行する
        if (this.getStreamType() !== 'RecordedHLS') {
            this.streamProcess.on('exit', () => {
                this.emitExitStream();
            });
            this.streamProcess.on('error', () => {
                this.emitExitStream();
            });
        } else {
            // stream 有効チェク開始
            this.startCheckStreamEnable(streamId);
        }
        // stream 停止タイマーセット
        this.setStopTimer();

        // ffmpeg debug 用ログ出力
        if (this.streamProcess.stderr !== null) {
            this.streamProcess.stderr.on('data', data => {
                this.log.stream.debug(String(data));
            });
        }

        // パイプ処理
        const inputReader = this.sourceReader?.readable ?? this.fileStream;
        if (this.streamProcess.stdin !== null && inputReader !== null) {
            // ts が入力かつ、HLS 配信の場合は arib-subtitle-timedmetadater を通す
            if (this.videoFileType === 'ts' && this.getStreamType() === 'RecordedHLS') {
                this.log.stream.info('use arib-subtitle-timedmetadater');
                this.id3MetadataTransoform = new ID3MetadataTransform();
                inputReader.pipe(this.id3MetadataTransoform);
                this.id3MetadataTransoform.pipe(this.streamProcess.stdin);
            } else {
                inputReader.pipe(this.streamProcess.stdin);
            }
        }

        // プロセスが即時終了していた場合
        if (ProcessUtil.isExited(this.streamProcess) === true) {
            this.streamProcess.removeAllListeners();
            this.emitExitStream();
        }
    }

    /** `IRecordedStreamBaseModel#setPlaybackSource`の実装。解放処理を持たない配信元向け。 */
    public setPlaybackSource(source: RecordedPlaybackSource): void {
        this.adoptPlaybackSource(source, async () => undefined);
    }

    /** `IRecordedStreamBaseModel#adoptPlaybackSource`の実装。 */
    public adoptPlaybackSource(source: RecordedPlaybackSource, release: () => Promise<void>): void {
        this.playbackSource = this.playbackSourceConsumer.consume(source);
        this.sourceReader = this.playbackSource.reader ?? null;
        this.playbackSourceRelease = release;
    }

    /**
     * video file 情報を格納する
     * @return Promise<void>
     */
    private async setVideFileInfo(): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.playbackSource !== null) {
            if (this.playbackSource.videoFileId !== this.processOption.videoFileId) {
                throw new Error('RecordedPlaybackSourceVideoFileIdMismatch');
            }

            this.videoFilePath = this.playbackSource.inputPath;
            this.videoFileInfo = this.playbackSource.videoInfo;
            this.videoFileType = this.playbackSource.reader === undefined ? 'encoded' : 'ts';
            return;
        }

        const video = await this.videoFileDB.findId(this.processOption.videoFileId);
        if (video === null) {
            throw new Error('VideoIsNull');
        }

        // recorded 情報セット
        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }
        this.isRecording = recorded.isRecording;

        // videoFilePath セット
        this.videoFilePath = await this.videoUtil.getFullFilePathFromId(video.id);
        if (this.videoFilePath === null) {
            throw new Error('GetVideoFilePathError');
        }

        // videoFileInfo セット
        this.videoFileInfo = await this.getVideoInfo(this.videoFilePath);

        this.videoFileType = video.type as apid.VideoFileType;
    }

    /**
     * 指定されたファイルパスのビデオ情報を取得する
     *
     * 録画済み番組管理機能が持つ共有の probe へ委譲する。共有側は ffprobe を argv で起動し、
     * 30 秒の deadline を過ぎたら SIGKILL へ escalate する。ここで ffprobe を自前で起動すると
     * その保護が効かず、ffprobe が終了しない状況（壊れた file、書き込み途中の録画、停止した
     * storage）で setOption が返らなくなり、配信開始の要求と子 process が残り続ける。
     * @param filePath: string
     * @return Promise<VideoFileInfo>
     */
    private getVideoInfo(filePath: string): Promise<VideoFileInfo> {
        return this.videoUtil.getInfo(filePath);
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @return Promise<CreateProcessOption>
     */
    private async createProcessOption(streamId: apid.StreamId): Promise<CreateProcessOption> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        let cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%SS%/g, this.videoFileType === 'ts' ? '' : this.processOption.playPosition.toString(10));

        if (this.getStreamType() === 'RecordedHLS') {
            cmd = cmd
                .replace(/%streamFileDir%/g, this.config.streamFilePath)
                .replace(/%streamNum%/g, streamId.toString(10));
        }

        const option: CreateProcessOption = {
            input:
                this.playbackSource === null
                    ? this.isRecording === true
                        ? null
                        : this.videoFilePath
                    : this.playbackSource.processInput,
            output:
                this.getStreamType() === 'RecordedHLS'
                    ? `${this.config.streamFilePath}\/stream${streamId.toString(10)}.m3u8`
                    : null,
            cmd: cmd,
            priority: RecordedStreamBaseModel.ENCODE_PROCESS_PRIORITY,
        };

        return option;
    }

    /**
     * fileStream をセットする
     */
    private setFileStream(): void {
        if (this.processOption === null || this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('VideoFileError');
        }

        if (this.playbackSource !== null) {
            this.sourceReader = this.playbackSource.reader ?? null;
            return;
        }

        // エンコードファイルなら何もしない
        if (this.videoFileType === 'encoded') {
            return;
        }

        this.log.stream.info(`create file stream: ${this.videoFilePath}`);
        const start = Math.floor((this.videoFileInfo.bitRate / 8) * this.processOption.playPosition);
        if (this.isRecording === true) {
            this.fileStream = fst.createReadStream(this.videoFilePath, {
                start: start,
            });
        } else {
            this.fileStream = fs.createReadStream(this.videoFilePath, {
                start: start,
            });
        }
    }

    /**
     * ストリームを停止する。同じ世代（`processStartGeneration`）から複数回呼ばれても
     * 実際の停止処理（`stopInternal`）は一度しか実行せず、以後は同じ Promise を返す
     * （`start()`未実施の世代未確定の状態でも同様に一度だけ実行する）。
     */
    public stop(): Promise<void> {
        const processStartGeneration = this.processStartGeneration;
        if (processStartGeneration === undefined) {
            if (this.stopOperationWithoutGeneration === null) {
                const nextStopOperation = this.createStopOperation();
                this.stopOperationWithoutGeneration = nextStopOperation.promise;
                void this.stopInternal().then(nextStopOperation.resolve, nextStopOperation.reject);
            }
            return this.stopOperationWithoutGeneration;
        }

        const stopOperation = this.stopOperations.get(processStartGeneration);
        if (stopOperation !== undefined) {
            return stopOperation;
        }

        const nextStopOperation = this.createStopOperation();
        this.stopOperations.set(processStartGeneration, nextStopOperation.promise);
        void this.stopInternal(processStartGeneration).then(nextStopOperation.resolve, nextStopOperation.reject);
        return nextStopOperation.promise;
    }

    /** 外部から resolve/reject できる Promise を1つ作る（`stop()`の結果キャッシュ用）。 */
    private createStopOperation(): {
        promise: Promise<void>;
        reject: (reason?: unknown) => void;
        resolve: () => void;
    } {
        let reject!: (reason?: unknown) => void;
        let resolve!: () => void;
        const promise = new Promise<void>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        return { promise, reject, resolve };
    }

    /**
     * 実際の停止処理本体。世代を停止済みとして記録し、進行中の playback source 解放を
     * 退避してから、保持している資源（ファイル stream・reader・変換 stream・プロセス・
     * HLS writer・artifact）を順に解放する。すべて完了した後、退避していた playback
     * source 解放が安全に実行できるかを確認する。
     */
    private async stopInternal(processStartGeneration = this.processStartGeneration): Promise<void> {
        const hlsStopFinalization = this.getStreamType() === 'RecordedHLS' ? this.getHlsStopFinalization() : null;
        if (processStartGeneration !== undefined) {
            this.stoppedProcessStartGenerations.add(processStartGeneration);
        }
        this.deferPlaybackSourceRelease();
        const streamProcessHandle = this.streamProcessHandle;
        const hlsWriterHandle = this.hlsWriterHandle;
        this.streamProcessHandle = null;
        this.hlsWriterHandle = null;
        await super.stop();

        const fileStream = this.fileStream;
        this.fileStream = null;
        if (fileStream !== null) {
            await this.tryCleanup(() => fileStream.unpipe());
            await this.tryCleanup(() => fileStream.destroy());
        }

        const sourceReader = this.sourceReader;
        this.sourceReader = null;
        if (sourceReader !== null) {
            await this.tryCleanup(() => sourceReader.close(), 'recorded playback source reader close error');
        }

        const id3MetadataTransoform = this.id3MetadataTransoform;
        this.id3MetadataTransoform = null;
        if (id3MetadataTransoform !== null) {
            await this.tryCleanup(() => id3MetadataTransoform.unpipe());
            await this.tryCleanup(() => id3MetadataTransoform.destroy());
        }

        if (streamProcessHandle !== null) {
            await this.tryCleanup(() => this.processManager.requestStop(streamProcessHandle));
        }
        if (hlsWriterHandle !== null) {
            if (hlsStopFinalization === null) {
                await this.tryCleanup(() => this.processManager.stopHls(hlsWriterHandle));
            } else {
                await this.stopHlsWriterAndReleaseWhenSafe(hlsStopFinalization, () =>
                    this.processManager.stopHls(hlsWriterHandle),
                );
            }
        }

        if (this.getStreamType() === 'RecordedHLS') {
            if (hlsStopFinalization === null) {
                await this.tryCleanup(() => this.fileDeleter.deleteAllFiles());
            } else {
                await this.cleanupHlsArtifacts(hlsStopFinalization);
            }
        }
        void this.releaseDeferredPlaybackSourceWhenSafe();
    }

    /**
     * managed process（非HLS）の終了（close/error/exit のいずれか最初のもの）を観測する
     * Promise を作り、`pendingManagedProcessTerminals`へ登録する。終了を観測したら
     * 登録を外し、playback source の遅延解放が可能になったか再確認する。
     */
    private observeManagedProcessTerminal(child: ChildProcess): void {
        let completeTerminal!: () => void;
        const terminal = new Promise<void>(resolve => {
            completeTerminal = resolve;
        });
        let isTerminal = false;
        const onTerminal = () => {
            if (isTerminal) {
                return;
            }
            isTerminal = true;
            child.removeListener('close', onTerminal);
            child.removeListener('error', onTerminal);
            child.removeListener('exit', onTerminal);
            completeTerminal();
        };
        child.once('close', onTerminal);
        child.once('error', onTerminal);
        child.once('exit', onTerminal);
        this.pendingManagedProcessTerminals.add(terminal);
        if (ProcessUtil.isExited(child) === true) {
            onTerminal();
        }
        void terminal.then(() => {
            this.pendingManagedProcessTerminals.delete(terminal);
            void this.releaseDeferredPlaybackSourceWhenSafe();
        });
    }

    /**
     * `start()`の起動処理（プロセス起動待ち）が完了したことを記録し、
     * playback source の遅延解放が可能になったか再確認する。
     */
    private finishProcessStartGeneration(processStartGeneration: object): void {
        if (this.pendingProcessStartGenerations.delete(processStartGeneration) === false) {
            return;
        }
        void this.releaseDeferredPlaybackSourceWhenSafe();
    }

    /**
     * HLS writer の停止中であることを`pendingHlsWriterStops`/`activeHlsWriterFinalizations`
     * で追跡しつつ停止し、完了後に playback source の遅延解放が可能になったか再確認する。
     */
    private async stopHlsWriterAndReleaseWhenSafe(
        finalization: HlsStopFinalization,
        operation: () => Promise<HlsWriterStopResult>,
    ): Promise<void> {
        this.pendingHlsWriterStops.add(finalization);
        try {
            await this.stopHlsWriter(finalization, operation);
        } finally {
            this.pendingHlsWriterStops.delete(finalization);
            this.activeHlsWriterFinalizations.delete(finalization);
            void this.releaseDeferredPlaybackSourceWhenSafe();
        }
    }

    /**
     * `playbackSourceRelease`を`deferredPlaybackSourceRelease`へ退避する。停止処理の
     * 開始時点ではプロセス・ライターがまだ入力を読んでいる可能性があるため、
     * 解放の実行自体は`releaseDeferredPlaybackSourceWhenSafe`が安全と判断するまで待つ。
     */
    private deferPlaybackSourceRelease(): void {
        const playbackSourceRelease = this.playbackSourceRelease;
        this.playbackSourceRelease = null;
        if (playbackSourceRelease !== null) {
            this.deferredPlaybackSourceRelease = playbackSourceRelease;
        }
    }

    /**
     * 退避済みの playback source 解放を、入力を読んでいるかもしれない全ての進行中処理
     * （起動処理・HLS writer 停止・非HLS プロセス終了監視、種別に応じて確認する対象が
     * 異なる）が無くなった時点でのみ実行する。まだ残っていれば何もしない。
     */
    private releaseDeferredPlaybackSourceWhenSafe(): Promise<void> {
        if (this.pendingProcessStartGenerations.size > 0) {
            return Promise.resolve();
        }
        if (this.getStreamType() === 'RecordedHLS') {
            if (this.activeHlsWriterFinalizations.size > 0) {
                return Promise.resolve();
            }
            return this.releaseDeferredPlaybackSource();
        }
        if (this.pendingManagedProcessTerminals.size === 0) {
            return this.releaseDeferredPlaybackSource();
        }
        return Promise.resolve();
    }

    /** 退避されていた playback source 解放処理があれば実行する。 */
    private async releaseDeferredPlaybackSource(): Promise<void> {
        const playbackSourceRelease = this.deferredPlaybackSourceRelease;
        this.deferredPlaybackSourceRelease = null;
        if (playbackSourceRelease !== null) {
            await this.tryCleanup(playbackSourceRelease, 'recorded playback source lease release error');
        }
    }

    private async tryCleanup(operation: () => Promise<unknown> | unknown, message?: string): Promise<void> {
        try {
            await operation();
        } catch (error: unknown) {
            try {
                if (message !== undefined) {
                    this.log.stream.error(message);
                }
                this.log.stream.error(error);
            } catch {
                // Diagnostics must not interrupt remaining resource cleanup.
            }
        }
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable
     */
    public getStream(): internal.Readable {
        if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
            return this.streamProcess.stdout;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return RecordedStreamInfo
     */
    public getInfo(): RecordedStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.configMode === null) {
            throw new Error('ConfigModeIsNull');
        }

        return {
            type: this.getStreamType(),
            mode: this.configMode,
            videoFileId: this.processOption.videoFileId,
            isEnable: this.isEnable(),
        };
    }

    protected abstract getStreamType(): 'RecordedStream' | 'RecordedHLS';
}
declare const __EPGSTATION_COVERAGE_EXCLUSION_RECORDED_STREAM_BASE_ONTERMINAL_REENTRY_20260924: unique symbol;
