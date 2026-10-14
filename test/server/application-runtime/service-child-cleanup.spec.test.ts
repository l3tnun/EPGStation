import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDefault } from './_runtime-harness';

/**
 * Web・API 側処理（子）が終了したときに、管理側（親）がその子の開始した外部プロセスを止めて後始末してから
 * 再起動へ進む契約（Requirement 8 Acceptance Criteria 8〜12）。process の状態は偽の system で表し、
 * 確認の間隔の待ちは即座に返して回数だけを記録する。
 */

type Signal = 'SIGINT' | 'SIGKILL';
type Identity =
    | { readonly status: 'running'; readonly startTime: string }
    | { readonly status: 'zombie' }
    | { readonly status: 'absent' }
    | { readonly status: 'unavailable' };

interface Entry {
    readonly pid: number;
    readonly kind: 'encode' | 'stream' | 'hls';
    readonly pgid?: number;
    readonly encodeId?: number;
    readonly streamId?: number;
    readonly startTime: string | null;
}

interface CleanupDependencies {
    readonly processes: { takeEntries(peer: object): Promise<readonly Entry[]> };
    readonly recordedUse: { releasePeer(peer: object): void };
    readonly encodeQueue: { list(): Promise<unknown[]> };
    readonly getParentDirPath: (name: string) => string | null;
    readonly hlsArtifacts: { deleteAllArtifacts(streamFilePath: string, isCancelled: () => boolean): Promise<void> };
    readonly streamFilePath: string;
    readonly removeInterruptedOutput: boolean;
    readonly system: FakeSystem;
    readonly logger: { error(value: unknown): void; info(value: unknown): void };
}

type CleanupConstructor = new (dependencies: CleanupDependencies) => { run(peer: object): Promise<void> };

const loadCleanup = (): CleanupConstructor => loadDefault<CleanupConstructor>('model/ServiceChildTerminationCleanup.js');

/**
 * 偽の process 表。signal を受けた後、`exitAfterChecks` 回の生存確認で居なくなる process を表せる。直接の process は
 * `identify`、process group（`group: true`）は `isGroupAlive` を生存確認として数える。
 */
class FakeSystem {
    public readonly ledger: string[] = [];
    private readonly processes = new Map<
        number,
        { identity: Identity; exitOn?: Signal; checksLeft?: number; group?: boolean }
    >();

    public setProcess(
        pid: number,
        identity: Identity,
        behaviour: { exitOn?: Signal; exitAfterChecks?: number; group?: boolean } = {},
    ): void {
        this.processes.set(pid, {
            identity,
            exitOn: behaviour.exitOn,
            checksLeft: behaviour.exitAfterChecks,
            group: behaviour.group,
        });
    }

    public identify(pid: number): Identity {
        const process = this.processes.get(pid);
        if (process === undefined) return { status: 'absent' };
        return process.group === true ? process.identity : this.current(pid, process);
    }

    public isAlive(pid: number): boolean {
        this.ledger.push(`alive ${pid}`);
        return this.identify(pid).status === 'running';
    }

    public isGroupAlive(pgid: number): boolean {
        this.ledger.push(`group-alive ${pgid}`);
        const process = this.processes.get(pgid);
        return process !== undefined && this.current(pgid, process).status === 'running';
    }

    public signal(pid: number, signal: Signal): void {
        this.ledger.push(`signal ${pid} ${signal}`);
        this.arm(pid, signal);
    }

    public signalGroup(pgid: number, signal: Signal): void {
        this.ledger.push(`signal-group ${pgid} ${signal}`);
        this.arm(pgid, signal);
    }

    public async wait(milliseconds: number): Promise<void> {
        this.ledger.push(`wait ${milliseconds}`);
    }

    public async removeFile(filePath: string): Promise<void> {
        this.ledger.push(`remove ${filePath}`);
    }

    private armed = new Map<number, number>();

    private arm(pid: number, signal: Signal): void {
        const process = this.processes.get(pid);
        if (process !== undefined && process.exitOn === signal) this.armed.set(pid, process.checksLeft ?? 0);
    }

    private current(pid: number, process: { identity: Identity }): Identity {
        const left = this.armed.get(pid);
        if (left === undefined) return process.identity;
        if (left <= 0) return { status: 'absent' };
        this.armed.set(pid, left - 1);
        return process.identity;
    }
}

const parentRoot = join('synthetic-recorded-root');

const makeCleanup = (
    entries: readonly Entry[],
    overrides: Partial<CleanupDependencies> = {},
): { cleanup: { run(peer: object): Promise<void> }; deps: CleanupDependencies; system: FakeSystem; peer: object } => {
    const system = overrides.system ?? new FakeSystem();
    const deps: CleanupDependencies = {
        processes: { takeEntries: vi.fn(async () => entries) },
        recordedUse: { releasePeer: vi.fn(() => system.ledger.push('release-leases')) },
        encodeQueue: {
            list: vi.fn(async () => [
                {
                    createdAt: 1,
                    id: 41,
                    option: { parentDir: 'synthetic', recordedId: 1, sourceVideoFileId: 1, mode: 'm' },
                    outputPath: join(parentRoot, 'synthetic-output-41.mp4'),
                },
                {
                    createdAt: 2,
                    id: 42,
                    option: { parentDir: 'synthetic', recordedId: 1, sourceVideoFileId: 1, mode: 'm' },
                    outputPath: join('synthetic-elsewhere', 'synthetic-output-42.mp4'),
                },
            ]),
        },
        getParentDirPath: vi.fn((name: string) => (name === 'synthetic' ? parentRoot : null)),
        hlsArtifacts: {
            deleteAllArtifacts: vi.fn(async (streamFilePath: string) => {
                system.ledger.push(`delete-hls ${streamFilePath}`);
            }),
        },
        streamFilePath: 'synthetic-stream-root',
        removeInterruptedOutput: true,
        system,
        logger: { error: vi.fn(), info: vi.fn() },
        ...overrides,
    };
    const Cleanup = loadCleanup();
    return { cleanup: new Cleanup(deps), deps, system, peer: new EventEmitter() };
};

const signalsOf = (ledger: readonly string[]): string[] => ledger.filter(line => line.startsWith('signal'));
const waitsOf = (ledger: readonly string[]): string[] => ledger.filter(line => line.startsWith('wait'));

afterEach(() => {
    vi.useRealTimers();
});

describe('service child termination cleanup', () => {
    it('[AR-8.8] stops an encode and a non-HLS stream process with one SIGINT each and never escalates to SIGKILL', async () => {
        const system = new FakeSystem();
        system.setProcess(701, { status: 'running', startTime: '1001' }, { exitOn: 'SIGINT', exitAfterChecks: 1 });
        system.setProcess(702, { status: 'running', startTime: '1002' });
        const { cleanup, deps, peer } = makeCleanup(
            [
                { pid: 701, kind: 'encode', encodeId: 41, startTime: '1001' },
                { pid: 702, kind: 'stream', startTime: '1002' },
            ],
            { system },
        );

        await cleanup.run(peer);

        expect(signalsOf(system.ledger).sort()).toEqual(['signal 701 SIGINT', 'signal 702 SIGINT']);
        // 702 never exits: three one-second checks, then it is left running without SIGKILL.
        expect(waitsOf(system.ledger).every(line => line === 'wait 1000')).toBe(true);
        expect(waitsOf(system.ledger)).toHaveLength(2 + 3);
        expect(deps.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'stream', pid: 702, sentSignals: ['SIGINT'], terminalConfirmed: false }),
        );
    });

    it('[AR-8.8] stops an HLS writer group with SIGINT, three checks, SIGKILL, and three more checks', async () => {
        const system = new FakeSystem();
        system.setProcess(
            801,
            { status: 'running', startTime: '2001' },
            { exitOn: 'SIGKILL', exitAfterChecks: 2, group: true },
        );
        const { cleanup, peer } = makeCleanup([{ pid: 801, pgid: 801, kind: 'hls', streamId: 3, startTime: '2001' }], {
            system,
        });

        await cleanup.run(peer);

        expect(signalsOf(system.ledger)).toEqual(['signal-group 801 SIGINT', 'signal-group 801 SIGKILL']);
        const sigkillAt = system.ledger.indexOf('signal-group 801 SIGKILL');
        expect(waitsOf(system.ledger.slice(0, sigkillAt))).toEqual(['wait 1000', 'wait 1000', 'wait 1000']);
        expect(waitsOf(system.ledger.slice(sigkillAt))).toHaveLength(3);
    });

    it('[AR-8.9] sends no signal to a reused PID, a zombie, or a process that is already gone', async () => {
        const system = new FakeSystem();
        system.setProcess(711, { status: 'running', startTime: '9999' });
        system.setProcess(712, { status: 'zombie' });
        system.setProcess(813, { status: 'running', startTime: '8888' }, { group: true });
        const { cleanup, peer } = makeCleanup(
            [
                { pid: 711, kind: 'encode', encodeId: 41, startTime: '1111' },
                { pid: 712, kind: 'stream', startTime: '1112' },
                { pid: 713, kind: 'stream', startTime: '1113' },
                { pid: 813, pgid: 813, kind: 'hls', streamId: 0, startTime: '1813' },
            ],
            { system },
        );

        await cleanup.run(peer);

        expect(signalsOf(system.ledger)).toEqual([]);
        // The encode was not running when the stop began, so its output is left to the restoration rules.
        expect(system.ledger.filter(line => line.startsWith('remove'))).toEqual([]);
    });

    it('[AR-8.9] signals the reported PID directly when the start time cannot be read', async () => {
        const system = new FakeSystem();
        system.setProcess(721, { status: 'unavailable' });
        vi.spyOn(system, 'isAlive').mockImplementation(pid => {
            system.ledger.push(`alive ${pid}`);
            return !system.ledger.includes(`signal ${pid} SIGINT`);
        });
        const { cleanup, peer } = makeCleanup([{ pid: 721, kind: 'stream', startTime: null }], { system });

        await cleanup.run(peer);

        expect(signalsOf(system.ledger)).toEqual(['signal 721 SIGINT']);
        expect(system.ledger.filter(line => line === 'alive 721')).toHaveLength(2);
    });

    it('[AR-8.10] deletes the in-progress output of a running encode inside its parent directory and every HLS artifact', async () => {
        const system = new FakeSystem();
        system.setProcess(731, { status: 'running', startTime: '3001' }, { exitOn: 'SIGINT' });
        system.setProcess(732, { status: 'running', startTime: '3002' }, { exitOn: 'SIGINT' });
        const { cleanup, deps, peer } = makeCleanup(
            [
                { pid: 731, kind: 'encode', encodeId: 41, startTime: '3001' },
                { pid: 732, kind: 'encode', encodeId: 42, startTime: '3002' },
            ],
            { system },
        );

        await cleanup.run(peer);

        expect(system.ledger.filter(line => line.startsWith('remove'))).toEqual([
            `remove ${join(parentRoot, 'synthetic-output-41.mp4')}`,
        ]);
        expect(deps.hlsArtifacts.deleteAllArtifacts).toHaveBeenCalledWith('synthetic-stream-root', expect.any(Function));
        expect(system.ledger.indexOf('delete-hls synthetic-stream-root')).toBeGreaterThan(
            system.ledger.indexOf(`remove ${join(parentRoot, 'synthetic-output-41.mp4')}`),
        );
    });

    it('[AR-8.10] keeps the in-progress output when encodeRemoveInterruptedOutput is disabled', async () => {
        const system = new FakeSystem();
        system.setProcess(741, { status: 'running', startTime: '4001' }, { exitOn: 'SIGINT' });
        const { cleanup, deps, peer } = makeCleanup([{ pid: 741, kind: 'encode', encodeId: 41, startTime: '4001' }], {
            system,
            removeInterruptedOutput: false,
        });

        await cleanup.run(peer);

        expect(system.ledger.filter(line => line.startsWith('remove'))).toEqual([]);
        expect(deps.hlsArtifacts.deleteAllArtifacts).toHaveBeenCalledOnce();
    });

    it('[AR-8.11] releases the recorded-use leases only after the stop and the deletions, even when an exit is unconfirmed', async () => {
        const system = new FakeSystem();
        system.setProcess(751, { status: 'running', startTime: '5001' }, { exitOn: 'SIGINT' });
        system.setProcess(752, { status: 'running', startTime: '5002' });
        const { cleanup, deps, peer } = makeCleanup(
            [
                { pid: 751, kind: 'encode', encodeId: 41, startTime: '5001' },
                { pid: 752, kind: 'stream', startTime: '5002' },
            ],
            { system },
        );

        await cleanup.run(peer);

        const releaseAt = system.ledger.indexOf('release-leases');
        expect(releaseAt).toBe(system.ledger.length - 1);
        expect(system.ledger.indexOf('delete-hls synthetic-stream-root')).toBeLessThan(releaseAt);
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledExactlyOnceWith(peer);
        expect(deps.logger.error).toHaveBeenCalledWith(
            'recorded-use leases are released although a process exit of the ended service child is not confirmed',
        );
    });

    it('[AR-8.12] gives up waiting after 30 seconds, releases the leases, and deletes no file afterwards', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        let resolveEntries: (entries: readonly Entry[]) => void = () => undefined;
        const { cleanup, deps, peer } = makeCleanup([], {
            system,
            processes: {
                takeEntries: () =>
                    new Promise<readonly Entry[]>(resolve => {
                        resolveEntries = resolve;
                    }),
            },
        });
        let settled = false;
        const run = cleanup.run(peer).then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await run;

        expect(deps.recordedUse.releasePeer).toHaveBeenCalledExactlyOnceWith(peer);
        expect(deps.logger.error).toHaveBeenCalledWith(
            'service child cleanup did not finish within 30000 ms; the service is restarted without waiting',
        );
        system.setProcess(761, { status: 'running', startTime: '6001' }, { exitOn: 'SIGINT' });
        resolveEntries([{ pid: 761, kind: 'encode', encodeId: 41, startTime: '6001' }]);
        await vi.runAllTimersAsync();

        expect(system.ledger.filter(line => line.startsWith('remove') || line.startsWith('delete-hls'))).toEqual([]);
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
});
