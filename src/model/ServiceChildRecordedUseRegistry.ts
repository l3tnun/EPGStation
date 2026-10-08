import type { ParentRecordedResourceUseRegistry, RecordedResourceUseKind } from './ipc/IRecordedResourceUse.js';
import type { RecordingRecordedUseGate } from './operator/recording/RecordingRecordedUseProvider.js';

type RecordedUseLease = {
    readonly kind: RecordedResourceUseKind;
    readonly recordedId: number;
    readonly requestId: number;
    readonly senderPeer: object;
};

type LifecyclePeer = {
    once(event: string, listener: () => void): unknown;
    removeListener(event: string, listener: () => void): unknown;
};

const terminalEvents = ['close', 'disconnect', 'error', 'exit'] as const;

const GRANTED = Object.freeze({ status: 'granted' as const });
const BLOCKED = Object.freeze({ status: 'blocked' as const });
const UNKNOWN = Object.freeze({ status: 'unknown' as const });
const BUSY = Object.freeze({ status: 'busy' as const });

/** Runtime-owned parent registry for service-child recorded resource use. */
export default class ServiceChildRecordedUseRegistry
    implements ParentRecordedResourceUseRegistry, RecordingRecordedUseGate
{
    private currentPeer: object | null = null;
    private readonly leasesByRecordedId = new Map<number, Set<RecordedUseLease>>();
    private readonly leasesByPeer = new WeakMap<object, Map<number, RecordedUseLease>>();
    private readonly lastReleasedRequestIds = new WeakMap<object, number>();
    private readonly deletionTokens = new Map<number, object>();
    private readonly deletionRecordedIds = new WeakMap<object, number>();
    private readonly observedPeers = new WeakSet<object>();
    private readonly terminalListeners = new WeakMap<object, () => void>();
    private readonly unknownLeases = new WeakSet<RecordedUseLease>();

    public registerPeer(peer: object): void {
        if (!this.isPeer(peer)) return;
        this.currentPeer = peer;
        if (this.observedPeers.has(peer) || !this.hasLifecycle(peer)) return;

        this.observedPeers.add(peer);
        const terminalListener = () => this.handlePeerTerminal(peer);
        this.terminalListeners.set(peer, terminalListener);
        for (const event of terminalEvents) peer.once(event, terminalListener);
    }

    public acquire(input: {
        readonly senderPeer: object;
        readonly requestId: number;
        readonly recordedId: number;
        readonly kind: RecordedResourceUseKind;
    }): { readonly status: 'granted' | 'blocked' | 'unknown' } {
        if (!this.isLeaseInput(input) || input.senderPeer !== this.currentPeer) return UNKNOWN;

        const peerLeases = this.leasesByPeer.get(input.senderPeer);
        if (peerLeases?.has(input.requestId) === true) return UNKNOWN;
        if (this.deletionTokens.has(input.recordedId)) return BLOCKED;

        const lease = Object.freeze({
            kind: input.kind,
            recordedId: input.recordedId,
            requestId: input.requestId,
            senderPeer: input.senderPeer,
        });
        const nextPeerLeases = peerLeases ?? new Map<number, RecordedUseLease>();
        nextPeerLeases.set(input.requestId, lease);
        this.leasesByPeer.set(input.senderPeer, nextPeerLeases);
        const recordedLeases = this.leasesByRecordedId.get(input.recordedId);
        const nextRecordedLeases = recordedLeases ?? new Set<RecordedUseLease>();
        nextRecordedLeases.add(lease);
        this.leasesByRecordedId.set(input.recordedId, nextRecordedLeases);
        this.lastReleasedRequestIds.delete(input.senderPeer);
        return GRANTED;
    }

    public release(input: {
        readonly senderPeer: object;
        readonly acquisitionRequestId: number;
    }): 'released' | 'already-released' | 'unknown' {
        if (!this.isReleaseInput(input)) return 'unknown';

        const peerLeases = this.leasesByPeer.get(input.senderPeer);
        const lease = peerLeases?.get(input.acquisitionRequestId);
        if (lease === undefined) {
            return this.lastReleasedRequestIds.get(input.senderPeer) === input.acquisitionRequestId
                ? 'already-released'
                : 'unknown';
        }
        const recordedLeases = this.leasesByRecordedId.get(lease.recordedId);
        if (recordedLeases?.has(lease) !== true) return 'unknown';

        peerLeases!.delete(input.acquisitionRequestId);
        this.unknownLeases.delete(lease);
        recordedLeases.delete(lease);
        if (recordedLeases.size === 0) this.leasesByRecordedId.delete(lease.recordedId);
        this.lastReleasedRequestIds.set(input.senderPeer, input.acquisitionRequestId);
        return 'released';
    }

    public tryAcquireDeletion(
        recordedId: number,
    ): { readonly token: object } | { readonly status: 'busy' | 'unknown' } {
        if (!this.isRecordedId(recordedId)) return UNKNOWN;
        if (this.currentPeer === null) return UNKNOWN;
        const leases = this.leasesByRecordedId.get(recordedId);
        if ([...(leases ?? [])].some(lease => this.unknownLeases.has(lease))) return UNKNOWN;
        if (leases !== undefined || this.deletionTokens.has(recordedId)) return BUSY;

        const token = Object.freeze(Object.create(null)) as object;
        this.deletionTokens.set(recordedId, token);
        this.deletionRecordedIds.set(token, recordedId);
        return Object.freeze({ token });
    }

    public releaseDeletion(token: object): void {
        const recordedId = this.deletionRecordedIds.get(token);
        if (recordedId === undefined || this.deletionTokens.get(recordedId) !== token) return;
        this.deletionTokens.delete(recordedId);
    }

    private isLeaseInput(input: {
        readonly senderPeer: object;
        readonly requestId: number;
        readonly recordedId: number;
        readonly kind: RecordedResourceUseKind;
    }): boolean {
        return (
            this.isPeer(input.senderPeer) &&
            this.isRequestId(input.requestId) &&
            this.isRecordedId(input.recordedId) &&
            (input.kind === 'encoding' || input.kind === 'delivery')
        );
    }

    private isReleaseInput(input: { readonly senderPeer: object; readonly acquisitionRequestId: number }): boolean {
        return this.isPeer(input.senderPeer) && this.isRequestId(input.acquisitionRequestId);
    }

    private isPeer(peer: object): boolean {
        return typeof peer === 'object' && peer !== null;
    }

    private hasLifecycle(peer: object): peer is object & LifecyclePeer {
        return (
            typeof (peer as Partial<LifecyclePeer>).once === 'function' &&
            typeof (peer as Partial<LifecyclePeer>).removeListener === 'function'
        );
    }

    private handlePeerTerminal(peer: object): void {
        const terminalListener = this.terminalListeners.get(peer);
        if (terminalListener !== undefined && this.hasLifecycle(peer)) {
            for (const event of terminalEvents) peer.removeListener(event, terminalListener);
            this.terminalListeners.delete(peer);
        }
        for (const lease of this.leasesByPeer.get(peer)?.values() ?? []) this.unknownLeases.add(lease);
        if (this.currentPeer === peer) this.currentPeer = null;
    }

    private isRequestId(requestId: number): boolean {
        return Number.isSafeInteger(requestId) && requestId > 0;
    }

    private isRecordedId(recordedId: number): boolean {
        return Number.isSafeInteger(recordedId) && recordedId > 0;
    }
}
