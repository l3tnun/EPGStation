import type { ServiceProcessKind } from './ipc/IServiceProcessReport.js';
import type { ProcessIdentity } from './ServiceChildProcessSystem.js';

/** Web・API 側処理が開始を知らせ、終了を知らせていない外部プロセス一件。 */
export interface ServiceChildProcessEntry {
    readonly pid: number;
    readonly kind: ServiceProcessKind;
    readonly pgid?: number;
    readonly encodeId?: number;
    readonly streamId?: number;
    /** 開始の知らせを受け取った時点の開始時刻。読めなかったときは `null`。 */
    readonly startTime: string | null;
}

interface ObservablePeer {
    on(event: string, listener: (...args: any[]) => void): unknown;
    once(event: string, listener: (...args: any[]) => void): unknown;
    removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

interface PeerState {
    readonly entries: Map<number, ServiceChildProcessEntry>;
    readonly drained: Promise<void>;
    readonly stopListening: () => void;
}

/** IPC 通路が閉じるのを待つ上限（ミリ秒）。 */
export const SERVICE_CHILD_REPORT_DRAIN_MS = 2_000;

/** IPC 通路が閉じたとみなす event。どちらかの後には、そのchildからの message は届かない。 */
const drainEvents = ['disconnect', 'close'] as const;

const isPositiveSafeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isStreamId = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * 管理側（親 process）で、Web・API 側処理（子 process）の世代ごとに、その世代が開始を知らせて終了を知らせていない
 * 外部プロセスを記録する。子 process を登録すると、その子の IPC 通路が閉じる（`disconnect` または `close`）まで、
 * `exit` や `error` の後に届いたものも含めて開始と終了の知らせを受け取る。知らせを受け取った時点で開始時刻を読み、
 * 後で停止するときに同じプロセスかを確かめられるようにする。
 */
export default class ServiceChildProcessRegistry {
    private readonly peers = new WeakMap<object, PeerState>();

    /**
     * @param dependencies 開始時刻の読取りと、捨てた知らせの記録
     * @param drainMilliseconds `takeEntries` が IPC 通路の閉じるのを待つ上限
     */
    constructor(
        private readonly dependencies: {
            identify(pid: number): ProcessIdentity;
            logger: { error(value: unknown): void };
        },
        private readonly drainMilliseconds: number = SERVICE_CHILD_REPORT_DRAIN_MS,
    ) {}

    /**
     * 新しく起動した Web・API 側処理を登録し、知らせの受け取りを始める。同じ子の二度目の登録と、
     * 監視できない値は無視する。
     * @param peer Web・API 側処理の child process
     */
    public registerPeer(peer: object): void {
        if (!this.isObservable(peer) || this.peers.has(peer)) return;

        const entries = new Map<number, ServiceChildProcessEntry>();
        let resolveDrained!: () => void;
        const drained = new Promise<void>(resolve => {
            resolveDrained = resolve;
        });
        const onMessage = (message: unknown): void => this.handleMessage(entries, message);
        const stopListening = (): void => {
            peer.removeListener('message', onMessage);
            for (const event of drainEvents) peer.removeListener(event, stopListening);
            resolveDrained();
        };
        peer.on('message', onMessage);
        for (const event of drainEvents) peer.once(event, stopListening);
        this.peers.set(peer, { drained, entries, stopListening });
    }

    /**
     * 終了した世代の外部プロセスを返し、その世代の記録を捨てる。IPC 通路が閉じるまで（最大
     * `drainMilliseconds`）待ってから確定し、待つのをやめた後は知らせを受け取らない。登録の無い子は空を返す。
     * @param peer 終了した Web・API 側処理
     * @returns 開始を知らせ、終了を知らせていない外部プロセス（知らせを受け取った順）
     */
    public async takeEntries(peer: object): Promise<ServiceChildProcessEntry[]> {
        const state = this.peers.get(peer);
        if (state === undefined) return [];

        let timer: NodeJS.Timeout | undefined;
        const limit = new Promise<void>(resolve => {
            timer = setTimeout(resolve, this.drainMilliseconds);
        });
        await Promise.race([state.drained, limit]);
        clearTimeout(timer);
        state.stopListening();
        this.peers.delete(peer);

        return [...state.entries.values()];
    }

    private handleMessage(entries: Map<number, ServiceChildProcessEntry>, message: unknown): void {
        if (typeof message !== 'object' || message === null) return;
        const candidate = message as Record<string, unknown>;
        if (candidate.type === 'serviceProcessEnded') {
            if (!isPositiveSafeInteger(candidate.pid)) {
                this.discard(message);
                return;
            }
            entries.delete(candidate.pid);
            return;
        }
        if (candidate.type !== 'serviceProcessStarted') return;

        const entry = this.toEntry(candidate);
        if (entry === null) {
            this.discard(message);
            return;
        }
        const identity = this.dependencies.identify(entry.pid);
        // 知らせを受け取る前に終わっていた process は記録しない（終了の知らせも続けて届く）。
        if (identity.status === 'absent' || identity.status === 'zombie') return;
        entries.set(entry.pid, {
            ...entry,
            startTime: identity.status === 'running' ? identity.startTime : null,
        });
    }

    private toEntry(candidate: Record<string, unknown>): Omit<ServiceChildProcessEntry, 'startTime'> | null {
        const { pid, kind } = candidate;
        if (!isPositiveSafeInteger(pid)) return null;
        if (kind === 'stream') return { kind, pid };
        if (kind === 'encode') {
            return isPositiveSafeInteger(candidate.encodeId) ? { encodeId: candidate.encodeId, kind, pid } : null;
        }
        if (kind === 'hls') {
            return isPositiveSafeInteger(candidate.pgid) && isStreamId(candidate.streamId)
                ? { kind, pgid: candidate.pgid, pid, streamId: candidate.streamId }
                : null;
        }
        return null;
    }

    private discard(message: unknown): void {
        this.dependencies.logger.error(`service process report discarded: ${JSON.stringify(message)}`);
    }

    private isObservable(peer: object): peer is object & ObservablePeer {
        return (
            typeof peer === 'object' &&
            peer !== null &&
            typeof (peer as Partial<ObservablePeer>).on === 'function' &&
            typeof (peer as Partial<ObservablePeer>).once === 'function' &&
            typeof (peer as Partial<ObservablePeer>).removeListener === 'function'
        );
    }
}
