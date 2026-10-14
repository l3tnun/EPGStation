import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDefault } from './_runtime-harness';

/**
 * Web・API 側処理（子）が終了したときに、管理側（親）がその子の開始した外部プロセスを止めて後始末してから
 * 再起動へ進む契約（Requirement 8 Acceptance Criteria 8〜12）。process の状態は偽の system で表し、確認の間隔の
 * 待ちは fake timer で進める。
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

interface RecordedFiles {
    readonly recordedDB: { findId(recordedId: number): Promise<unknown> };
    readonly videoUtil: {
        getFullFilePathFromVideoFile(videoFile: { fullPath: string }): string | null;
        getParentDirPath(name: string): string | null;
    };
}

interface CleanupDependencies {
    readonly processes: { takeEntries(peer: object): Promise<readonly Entry[]> };
    readonly recordedUse: { releasePeer(peer: object): void };
    readonly encodeQueue: { list(): Promise<unknown[]> };
    readonly resolveRecordedFiles: () => RecordedFiles;
    readonly isSameFile: (a: string, b: string) => Promise<boolean>;
    readonly hlsArtifacts: { deleteAllArtifacts(streamFilePath: string, isCancelled: () => boolean): Promise<unknown> };
    readonly streamFilePath: string;
    readonly removeInterruptedOutput: boolean;
    readonly system: FakeSystem;
    readonly logger: { error(value: unknown): void; info(value: unknown): void };
}

type CleanupConstructor = new (dependencies: CleanupDependencies) => { run(peer: object): Promise<void> };

const loadCleanup = (): CleanupConstructor => loadDefault<CleanupConstructor>('model/ServiceChildTerminationCleanup.js');

interface FakeProcess {
    identity: Identity;
    exitOn?: Signal;
    checksLeft?: number;
    group?: 'members' | 'zombie-members' | 'unreadable';
}

/**
 * 偽の process 表。signal を受けた後、`exitAfterChecks` 回の生存確認で居なくなる process を表せる。`identify`
 * （group は leader の確認）、`hasLiveGroupMember`、`isGroupAlive` のそれぞれを生存確認として数える。
 * `zombie-members` のgroupは、`kill(-pgid, 0)` には居るように見えるが終了済みの member だけが残るgroupを表す。
 */
class FakeSystem {
    public readonly ledger: string[] = [];
    private readonly processes = new Map<number, FakeProcess>();
    private readonly armed = new Map<number, number>();

    public setProcess(
        pid: number,
        identity: Identity,
        behaviour: { exitOn?: Signal; exitAfterChecks?: number; group?: FakeProcess['group'] } = {},
    ): void {
        this.processes.set(pid, {
            identity,
            exitOn: behaviour.exitOn,
            checksLeft: behaviour.exitAfterChecks,
            group: behaviour.group,
        });
    }

    public exit(pid: number): void {
        this.armed.set(pid, 0);
    }

    public identify(pid: number): Identity {
        const process = this.processes.get(pid);
        if (process === undefined) return { status: 'absent' };
        return this.current(pid, process);
    }

    public isAlive(pid: number): boolean {
        this.ledger.push(`alive ${pid}`);
        return this.identify(pid).status === 'running';
    }

    public hasLiveGroupMember(pgid: number): boolean | undefined {
        this.ledger.push(`group-members ${pgid}`);
        const process = this.processes.get(pgid);
        if (process === undefined) return false;
        if (process.group === 'unreadable') return undefined;
        if (process.group === 'zombie-members') return false;
        return this.current(pgid, process).status === 'running';
    }

    public isGroupAlive(pgid: number): boolean {
        this.ledger.push(`group-alive ${pgid}`);
        const process = this.processes.get(pgid);
        // kill(-pgid, 0) succeeds for any member that has not been reaped, whatever its start time can be read as.
        return process !== undefined && this.current(pgid, process).status !== 'absent';
    }

    public signal(pid: number, signal: Signal): void {
        this.ledger.push(`signal ${pid} ${signal}`);
        this.arm(pid, signal);
    }

    public signalGroup(pgid: number, signal: Signal): void {
        this.ledger.push(`signal-group ${pgid} ${signal}`);
        this.arm(pgid, signal);
    }

    public wait(milliseconds: number): Promise<void> {
        this.ledger.push(`wait ${milliseconds}`);
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    public async removeFile(filePath: string): Promise<void> {
        this.ledger.push(`remove ${filePath}`);
    }

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
const sourcePath = join(parentRoot, 'synthetic-source.ts');
const registeredPath = join(parentRoot, 'synthetic-registered.mp4');

const queueRecord = (id: number, outputPath: string, recordedId = 1) => ({
    createdAt: id,
    id,
    option: { mode: 'm', parentDir: 'synthetic', recordedId, removeOriginal: false, sourceVideoFileId: 10 },
    outputPath,
});

const makeCleanup = (
    entries: readonly Entry[],
    overrides: Partial<CleanupDependencies> = {},
): { cleanup: { run(peer: object): Promise<void> }; deps: CleanupDependencies; system: FakeSystem; peer: object } => {
    const system = overrides.system ?? new FakeSystem();
    const recorded = {
        id: 1,
        videoFiles: [
            { fullPath: sourcePath, id: 10 },
            { fullPath: registeredPath, id: 11 },
        ],
    };
    const deps: CleanupDependencies = {
        processes: { takeEntries: vi.fn(async () => entries) },
        recordedUse: { releasePeer: vi.fn(() => system.ledger.push('release-leases')) },
        encodeQueue: {
            list: vi.fn(async () => [
                queueRecord(41, join(parentRoot, 'synthetic-output-41.mp4')),
                queueRecord(42, join('synthetic-elsewhere', 'synthetic-output-42.mp4')),
                queueRecord(43, registeredPath),
                queueRecord(44, join(parentRoot, 'synthetic-output-44.mp4'), 2),
            ]),
        },
        resolveRecordedFiles: () => ({
            recordedDB: { findId: async (recordedId: number) => (recordedId === 1 ? recorded : null) },
            videoUtil: {
                getFullFilePathFromVideoFile: (videoFile: { fullPath: string }) => videoFile.fullPath,
                getParentDirPath: (name: string) => (name === 'synthetic' ? parentRoot : null),
            },
        }),
        isSameFile: vi.fn(async () => false),
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

/** fake timer の下で後始末を最後まで進め、終わった時刻（ミリ秒）を返す。 */
const runToEnd = async (cleanup: { run(peer: object): Promise<void> }, peer: object): Promise<number> => {
    const startedAt = Date.now();
    let settledAt: number | null = null;
    const run = cleanup.run(peer).then(() => {
        settledAt = Date.now();
    });
    await vi.runAllTimersAsync();
    await run;
    return (settledAt ?? Date.now()) - startedAt;
};

const signalsOf = (ledger: readonly string[]): string[] => ledger.filter(line => line.startsWith('signal'));
const waitsOf = (ledger: readonly string[]): string[] => ledger.filter(line => line.startsWith('wait'));
const removalsOf = (ledger: readonly string[]): string[] =>
    ledger.filter(line => line.startsWith('remove') || line.startsWith('delete-hls'));

afterEach(() => {
    vi.useRealTimers();
});

describe('service child termination cleanup', () => {
    it('[AR-8.8] stops an encode and a non-HLS stream process with one SIGINT each and never escalates to SIGKILL', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(701, { status: 'running', startTime: '1001' }, { exitOn: 'SIGINT', exitAfterChecks: 1 });
        system.setProcess(702, { status: 'running', startTime: '1002' }, { exitOn: 'SIGINT', exitAfterChecks: 3 });
        const { cleanup, deps, peer } = makeCleanup(
            [
                { pid: 701, kind: 'encode', encodeId: 41, startTime: '1001' },
                { pid: 702, kind: 'stream', startTime: '1002' },
            ],
            { system },
        );

        await runToEnd(cleanup, peer);

        expect(signalsOf(system.ledger).sort()).toEqual(['signal 701 SIGINT', 'signal 702 SIGINT']);
        // 701 exits on the second check, 702 on the fourth: three one-second checks, then it is still running and
        // receives no further signal.
        expect(waitsOf(system.ledger).every(line => line === 'wait 1000')).toBe(true);
        expect(deps.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'stream', pid: 702, sentSignals: ['SIGINT'], terminalConfirmed: false }),
        );
    });

    it('[AR-8.8] stops an HLS writer group with SIGINT, three checks, SIGKILL, and three more checks', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(
            801,
            { status: 'running', startTime: '2001' },
            { exitOn: 'SIGKILL', exitAfterChecks: 2, group: 'members' },
        );
        const { cleanup, deps, peer } = makeCleanup(
            [{ pid: 801, pgid: 801, kind: 'hls', streamId: 3, startTime: '2001' }],
            { system },
        );

        await runToEnd(cleanup, peer);

        expect(signalsOf(system.ledger)).toEqual(['signal-group 801 SIGINT', 'signal-group 801 SIGKILL']);
        const sigkillAt = system.ledger.indexOf('signal-group 801 SIGKILL');
        expect(waitsOf(system.ledger.slice(0, sigkillAt))).toEqual(['wait 1000', 'wait 1000', 'wait 1000']);
        expect(waitsOf(system.ledger.slice(sigkillAt))).toHaveLength(3);
        expect(deps.logger.error).not.toHaveBeenCalled();
    });

    it('[AR-8.9] sends no signal to a reused PID, a zombie, a process that is already gone, or a reused group leader', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(711, { status: 'running', startTime: '9999' });
        system.setProcess(712, { status: 'zombie' });
        system.setProcess(813, { status: 'running', startTime: '8888' }, { group: 'members' });
        const { cleanup, peer } = makeCleanup(
            [
                { pid: 711, kind: 'encode', encodeId: 41, startTime: '1111' },
                { pid: 712, kind: 'stream', startTime: '1112' },
                { pid: 713, kind: 'stream', startTime: '1113' },
                { pid: 813, pgid: 813, kind: 'hls', streamId: 0, startTime: '1813' },
            ],
            { system },
        );

        await runToEnd(cleanup, peer);

        expect(signalsOf(system.ledger)).toEqual([]);
        // The encode was not running when the stop began, so its output is left to the restoration rules.
        expect(system.ledger.filter(line => line.startsWith('remove'))).toEqual([]);
    });

    it('[AR-8.9] treats a group whose leader and members are only zombies as ended without SIGKILL or an unconfirmed error', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(821, { status: 'zombie' }, { group: 'zombie-members' });
        system.setProcess(822, { status: 'running', startTime: '2822' }, { group: 'members', exitOn: 'SIGINT' });
        const { cleanup, deps, peer } = makeCleanup(
            [
                { pid: 821, pgid: 821, kind: 'hls', streamId: 1, startTime: '2821' },
                { pid: 822, pgid: 822, kind: 'hls', streamId: 2, startTime: '2822' },
            ],
            { system },
        );

        const elapsed = await runToEnd(cleanup, peer);

        expect(signalsOf(system.ledger)).toEqual(['signal-group 822 SIGINT']);
        expect(system.ledger).not.toContain('group-alive 821');
        expect(deps.logger.error).not.toHaveBeenCalled();
        expect(elapsed).toBe(1_000);
    });

    it('[AR-8.9] counts a running group leader with the reported start time as alive without scanning the group members', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        // The member scan would report no live member (as when /proc/<pid>/stat cannot be read), but the leader itself runs.
        system.setProcess(841, { status: 'running', startTime: '2841' }, { group: 'zombie-members', exitOn: 'SIGINT' });
        const { cleanup, deps, peer } = makeCleanup(
            [{ pid: 841, pgid: 841, kind: 'hls', streamId: 5, startTime: '2841' }],
            { system },
        );

        await runToEnd(cleanup, peer);

        expect(signalsOf(system.ledger)).toEqual(['signal-group 841 SIGINT']);
        const scans = system.ledger.filter(line => line === 'group-members 841');
        expect(scans).toEqual(['group-members 841']);
        expect(system.ledger.indexOf('group-members 841')).toBeGreaterThan(
            system.ledger.indexOf('signal-group 841 SIGINT'),
        );
        expect(deps.logger.error).not.toHaveBeenCalled();
    });

    it('[AR-8.9] signals the reported PID and PGID directly and probes them when neither can be read', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(721, { status: 'unavailable' });
        system.setProcess(831, { status: 'unavailable' }, { group: 'unreadable', exitOn: 'SIGINT' });
        vi.spyOn(system, 'isAlive').mockImplementation(pid => {
            system.ledger.push(`alive ${pid}`);
            return !system.ledger.includes(`signal ${pid} SIGINT`);
        });
        const { cleanup, peer } = makeCleanup(
            [
                { pid: 721, kind: 'stream', startTime: null },
                { pid: 831, pgid: 831, kind: 'hls', streamId: 4, startTime: null },
            ],
            { system },
        );

        await runToEnd(cleanup, peer);

        expect(signalsOf(system.ledger).sort()).toEqual(['signal 721 SIGINT', 'signal-group 831 SIGINT']);
        expect(system.ledger.filter(line => line === 'alive 721')).toHaveLength(2);
        expect(system.ledger.filter(line => line === 'group-alive 831')).toHaveLength(2);
    });

    it('[AR-8.10] deletes the output of a running encode only under the restoration rule, then every HLS artifact', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        for (const pid of [731, 732, 733, 734, 735]) {
            system.setProcess(pid, { status: 'running', startTime: `${pid}` }, { exitOn: 'SIGINT' });
        }
        const isSameFile = vi.fn(async (a: string, b: string) => a === sourcePath && b.endsWith('synthetic-output-41.mp4'));
        const { cleanup, deps, peer } = makeCleanup(
            [
                { pid: 731, kind: 'encode', encodeId: 41, startTime: '731' },
                { pid: 732, kind: 'encode', encodeId: 42, startTime: '732' },
                { pid: 733, kind: 'encode', encodeId: 43, startTime: '733' },
                { pid: 734, kind: 'encode', encodeId: 44, startTime: '734' },
                { pid: 735, kind: 'encode', encodeId: 45, startTime: '735' },
            ],
            { system, isSameFile: vi.fn(async () => false) },
        );

        await runToEnd(cleanup, peer);

        // 41: inside the parent and not registered -> removed. 42: outside the parent. 43: registered as a recorded
        // file. 44: its recorded program is gone. 45: no record.
        expect(system.ledger.filter(line => line.startsWith('remove'))).toEqual([
            `remove ${join(parentRoot, 'synthetic-output-41.mp4')}`,
        ]);
        expect(deps.hlsArtifacts.deleteAllArtifacts).toHaveBeenCalledWith('synthetic-stream-root', expect.any(Function));
        expect(system.ledger.indexOf('delete-hls synthetic-stream-root')).toBeGreaterThan(
            system.ledger.indexOf(`remove ${join(parentRoot, 'synthetic-output-41.mp4')}`),
        );

        const sameFile = makeCleanup([{ pid: 736, kind: 'encode', encodeId: 41, startTime: '736' }], { isSameFile });
        sameFile.system.setProcess(736, { status: 'running', startTime: '736' }, { exitOn: 'SIGINT' });
        await runToEnd(sameFile.cleanup, sameFile.peer);
        expect(sameFile.system.ledger.filter(line => line.startsWith('remove'))).toEqual([]);
    });

    it('[AR-8.10] keeps the in-progress output when encodeRemoveInterruptedOutput is disabled', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(741, { status: 'running', startTime: '4001' }, { exitOn: 'SIGINT' });
        const { cleanup, deps, peer } = makeCleanup([{ pid: 741, kind: 'encode', encodeId: 41, startTime: '4001' }], {
            system,
            removeInterruptedOutput: false,
        });

        await runToEnd(cleanup, peer);

        expect(system.ledger.filter(line => line.startsWith('remove'))).toEqual([]);
        expect(deps.hlsArtifacts.deleteAllArtifacts).toHaveBeenCalledOnce();
    });

    it('[AR-8.11] keeps checking an unconfirmed process every second and deletes and releases only once it is gone', async () => {
        vi.useFakeTimers();
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
        let settled = false;
        const run = cleanup.run(peer).then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(10_000);
        expect(settled).toBe(false);
        expect(deps.recordedUse.releasePeer).not.toHaveBeenCalled();
        expect(removalsOf(system.ledger)).toEqual([]);
        system.exit(752);
        await vi.advanceTimersByTimeAsync(1_000);
        await run;

        expect(signalsOf(system.ledger).sort()).toEqual(['signal 751 SIGINT', 'signal 752 SIGINT']);
        expect(removalsOf(system.ledger)).toEqual([
            `remove ${join(parentRoot, 'synthetic-output-41.mp4')}`,
            'delete-hls synthetic-stream-root',
        ]);
        expect(system.ledger[system.ledger.length - 1]).toBe('release-leases');
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledExactlyOnceWith(peer);
        expect(deps.logger.error).not.toHaveBeenCalledWith(expect.stringContaining('did not finish'));
    });

    it('[AR-8.12] releases the leases at the 30-second cap while a process is still unconfirmed and deletes nothing', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(761, { status: 'running', startTime: '6001' });
        const { cleanup, deps, peer } = makeCleanup([{ pid: 761, kind: 'encode', encodeId: 41, startTime: '6001' }], {
            system,
        });
        let settled = false;
        const run = cleanup.run(peer).then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).toBe(false);
        expect(deps.recordedUse.releasePeer).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await run;

        expect(deps.recordedUse.releasePeer).toHaveBeenCalledExactlyOnceWith(peer);
        expect(deps.logger.error).toHaveBeenCalledWith(
            'service child cleanup did not finish within 30000 ms; the service is restarted without waiting',
        );
        system.exit(761);
        await vi.runAllTimersAsync();
        expect(removalsOf(system.ledger)).toEqual([]);
        expect(signalsOf(system.ledger)).toEqual(['signal 761 SIGINT']);
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[AR-8.12] gives up waiting for the reports after 30 seconds and deletes no file afterwards', async () => {
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

        const run = cleanup.run(peer);
        await vi.advanceTimersByTimeAsync(30_000);
        await run;
        system.setProcess(762, { status: 'running', startTime: '6002' }, { exitOn: 'SIGINT' });
        resolveEntries([{ pid: 762, kind: 'encode', encodeId: 41, startTime: '6002' }]);
        await vi.runAllTimersAsync();

        expect(removalsOf(system.ledger)).toEqual([]);
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[AR-8.12] stops deleting HLS artifacts and further outputs once the cap passes in the middle of the deletion', async () => {
        vi.useFakeTimers();
        const system = new FakeSystem();
        system.setProcess(771, { status: 'running', startTime: '7001' }, { exitOn: 'SIGINT' });
        system.setProcess(772, { status: 'running', startTime: '7002' }, { exitOn: 'SIGINT' });
        const hlsCancellation: boolean[] = [];
        const removeFile = vi.fn(async (filePath: string) => {
            system.ledger.push(`remove ${filePath}`);
            await new Promise(resolve => setTimeout(resolve, 40_000));
        });
        vi.spyOn(system, 'removeFile').mockImplementation(removeFile);
        const { cleanup, deps, peer } = makeCleanup(
            [
                { pid: 771, kind: 'encode', encodeId: 41, startTime: '7001' },
                { pid: 772, kind: 'encode', encodeId: 46, startTime: '7002' },
            ],
            {
                system,
                encodeQueue: {
                    list: vi.fn(async () => [
                        queueRecord(41, join(parentRoot, 'synthetic-output-41.mp4')),
                        queueRecord(46, join(parentRoot, 'synthetic-output-46.mp4')),
                    ]),
                },
                hlsArtifacts: {
                    deleteAllArtifacts: vi.fn(async (_streamFilePath: string, isCancelled: () => boolean) => {
                        hlsCancellation.push(isCancelled());
                    }),
                },
            },
        );

        const run = cleanup.run(peer);
        await vi.advanceTimersByTimeAsync(30_000);
        await run;
        await vi.runAllTimersAsync();

        expect(removeFile.mock.calls).toEqual([[join(parentRoot, 'synthetic-output-41.mp4')]]);
        expect(deps.hlsArtifacts.deleteAllArtifacts).not.toHaveBeenCalled();
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledOnce();

        const hls = makeCleanup([], {
            hlsArtifacts: {
                deleteAllArtifacts: vi.fn(async (_streamFilePath: string, isCancelled: () => boolean) => {
                    hlsCancellation.push(isCancelled());
                    await new Promise(resolve => setTimeout(resolve, 40_000));
                    hlsCancellation.push(isCancelled());
                }),
            },
        });
        const hlsRun = hls.cleanup.run(hls.peer);
        await vi.advanceTimersByTimeAsync(30_000);
        await hlsRun;
        await vi.runAllTimersAsync();
        expect(hlsCancellation).toEqual([false, true]);
    });

    it('[AR-8.12] records a failed cleanup, still releases the leases once, and never rejects', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic cleanup failure');
        const { cleanup, deps, peer } = makeCleanup([], {
            processes: { takeEntries: vi.fn(async () => Promise.reject(failure)) },
        });

        await expect(runToEnd(cleanup, peer)).resolves.toBe(0);

        expect(deps.logger.error).toHaveBeenCalledWith('service child cleanup failed');
        expect(deps.logger.error).toHaveBeenCalledWith(failure);
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledExactlyOnceWith(peer);
    });
});
