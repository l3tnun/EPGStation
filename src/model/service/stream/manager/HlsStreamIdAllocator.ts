import { inject, injectable } from 'inversify';
import type * as apid from '../../../../../api.js';
import IConfigFile from '../../../IConfigFile.js';
import IConfiguration from '../../../IConfiguration.js';
import ILogger from '../../../ILogger.js';
import ILoggerModel from '../../../ILoggerModel.js';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel.js';
import IStreamIdAllocator from './IStreamIdAllocator.js';

/**
 * DI コンテナが 'IHLSFileDeleterModel' に束縛する実体（HLSFileDeleterModel）が、
 * IHLSFileDeleterModel の宣言（setOption/deleteAllFiles）に加えて公開している
 * 走査系 method。`HlsStreamIdAllocator` はこの拡張された形として注入を受け取って使う。
 */
interface ArtifactIndex extends IHLSFileDeleterModel {
    listExact(streamFilePath: string, streamId: number): Promise<string[]>;
    scanAtStartup(streamFilePath: string): Promise<ReadonlySet<number>>;
    scanCurrent(streamFilePath: string): Promise<ReadonlySet<number>>;
}

/**
 * HLS のセグメントファイル（`stream<ID>.m3u8` 等）と streamId が衝突しないよう
 * 採番するための IStreamIdAllocator 実装。
 *
 * このクラス自身が「HLS」を名乗るのは構わない —— IStreamManageModel/StreamManageModel
 * からは常に IStreamIdAllocator という一般名の interface 越しにしか参照されず、
 * この実装クラス名や、ここで検査しているファイル種別を manager 側が知ることはない。
 */
@injectable()
class HlsStreamIdAllocator implements IStreamIdAllocator {
    /** 次に採番を試す streamId の起点。`reserve`/`release` のたびに前進する（単純な巡回カーソル）。 */
    private allocationCursor = 0;
    /** 走査系 method を提供する collaborator。config か artifactIndex のいずれかが無ければ機能全体が無効になる。 */
    private readonly artifactIndex: ArtifactIndex | null;
    /** streamFilePath 等の設定値。constructor 時に一度だけ取得し、以降変化しない。 */
    private readonly config: IConfigFile | null;
    /** `captureSnapshot`/`markKnownCollision` で更新される、現時点で衝突が既知の streamId 集合。 */
    private currentArtifactIds = new Set<number>();
    /** 起動時走査（`scanAtStartup`）の進行中 Promise。`beginInitialization` が冪等になるよう、完了・失敗まで保持する。 */
    private initialization: Promise<void> | null = null;
    private readonly log: ILogger;
    /** `captureSnapshot` が反映を試みたスナップショットの世代番号。古い世代の反映を無視するための比較用。 */
    private snapshotAppliedSequence = 0;
    /** `captureSnapshot` が発行するスナップショット取得要求の連番。並行呼び出しの前後関係を判定するために使う。 */
    private snapshotSequence = 0;
    /** 起動時走査（`scanAtStartup`）で見つかった streamId 集合。プロセス起動後は更新されない。 */
    private startupArtifactIds = new Set<number>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration?: IConfiguration,
        @inject('IHLSFileDeleterModel') artifactIndex?: ArtifactIndex,
    ) {
        this.log = logger.getLogger();
        this.config = configuration?.getConfig() ?? null;
        this.artifactIndex = artifactIndex ?? null;
        if (this.isAvailable()) {
            this.beginInitialization();
        }
    }

    public isAvailable(): boolean {
        return this.config !== null && this.artifactIndex !== null;
    }

    public beginInitialization(): void {
        if (this.initialization !== null) {
            return;
        }

        const streamFilePath = this.config!.streamFilePath;
        const initialization = this.artifactIndex!.scanAtStartup(streamFilePath).then(ids => {
            this.startupArtifactIds = new Set(ids);
        });
        this.initialization = initialization;
        void initialization.catch((error: unknown) => {
            this.log.stream.error(`hls artifact index initialization error: ${streamFilePath}`);
            this.log.stream.error(error);
            this.initialization = null;
        });
    }

    public async captureSnapshot(): Promise<ReadonlySet<apid.StreamId> | null> {
        if (this.isAvailable() === false) {
            return null;
        }

        this.beginInitialization();
        await this.initialization;

        const sequence = ++this.snapshotSequence;
        const snapshot = await this.artifactIndex!.scanCurrent(this.config!.streamFilePath);
        if (sequence > this.snapshotAppliedSequence) {
            this.snapshotAppliedSequence = sequence;
            this.currentArtifactIds = new Set(snapshot);
        }
        return snapshot;
    }

    public reserve(activeStreamIds: Iterable<apid.StreamId>, snapshot: ReadonlySet<apid.StreamId>): apid.StreamId {
        const unavailable = new Set<number>([
            ...activeStreamIds,
            ...this.startupArtifactIds,
            ...this.currentArtifactIds,
            ...snapshot,
        ]);
        const candidate = this.findAvailable(unavailable, this.allocationCursor);
        this.allocationCursor = this.nextStreamId(candidate);
        return candidate;
    }

    /**
     * `cursor` から近い順（`streamIdDistance` で測った巡回距離）に空いている streamId を探す。
     * 単純に先頭から線形探索するのではなく距離順に並べ替えるのは、`unavailable` が
     * 密集している場合でも cursor に近い値を優先して選び、streamId の値が際限なく
     * 増え続けないようにするため。
     */
    private findAvailable(unavailable: ReadonlySet<number>, cursor: number): number {
        const orderedIds = [...unavailable].sort(
            (a, b) => this.streamIdDistance(cursor, a) - this.streamIdDistance(cursor, b),
        );
        let candidate = cursor;
        for (const occupiedId of orderedIds) {
            if (occupiedId !== candidate) {
                break;
            }
            candidate = this.nextStreamId(candidate);
        }
        if (unavailable.has(candidate)) {
            throw new Error('HLSStreamIdUnavailable');
        }
        return candidate;
    }

    public async hasArtifactCollision(streamId: apid.StreamId): Promise<boolean> {
        const files = await this.artifactIndex!.listExact(this.config!.streamFilePath, streamId);
        return files.length > 0;
    }

    public markKnownCollision(streamId: apid.StreamId): void {
        this.currentArtifactIds.add(streamId);
    }

    public knownCollisions(): ReadonlySet<apid.StreamId> {
        return this.currentArtifactIds;
    }

    public release(streamId: apid.StreamId): void {
        this.allocationCursor = this.nextStreamId(streamId);
    }

    private nextStreamId(streamId: number): number {
        return streamId === Number.MAX_SAFE_INTEGER ? 0 : streamId + 1;
    }

    /**
     * `from` から `to` までの巡回距離（`to` が `from` より小さい場合は
     * `Number.MAX_SAFE_INTEGER` を折り返し点として一周した距離）を返す。
     */
    private streamIdDistance(from: number, to: number): number {
        return to >= from ? to - from : Number.MAX_SAFE_INTEGER - from + to + 1;
    }
}

export default HlsStreamIdAllocator;
declare const __EPGSTATION_COVERAGE_EXCLUSION_HLS_STREAM_ID_ALLOCATOR_UNAVAILABLE_20260924: unique symbol;
