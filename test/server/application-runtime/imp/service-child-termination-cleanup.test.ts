import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDefault } from '../_runtime-harness';

type Signal = 'SIGINT' | 'SIGKILL';

interface Entry {
    readonly pid: number;
    readonly kind: 'encode' | 'stream' | 'hls';
    readonly pgid?: number;
    readonly encodeId?: number;
    readonly streamId?: number;
    readonly startTime: string | null;
}

type CleanupConstructor = new (dependencies: Record<string, unknown>) => { run(peer: object): Promise<void> };

const Cleanup = loadDefault<CleanupConstructor>('model/ServiceChildTerminationCleanup.js');

/** 一度だけ signal を受けて居なくなる process の表。 */
const makeSystem = (overrides: Record<string, unknown> = {}) => {
    const ledger: string[] = [];
    const gone = new Set<number>();
    return {
        ledger,
        system: {
            identify: vi.fn((pid: number) =>
                gone.has(pid) ? { status: 'absent' } : { startTime: `start-${pid}`, status: 'running' },
            ),
            isAlive: vi.fn(() => true),
            isGroupAlive: vi.fn((pgid: number) => !gone.has(pgid)),
            signal: vi.fn((pid: number, signal: Signal) => {
                ledger.push(`signal ${pid} ${signal}`);
                gone.add(pid);
            }),
            signalGroup: vi.fn((pgid: number, signal: Signal) => {
                ledger.push(`signal-group ${pgid} ${signal}`);
                gone.add(pgid);
            }),
            wait: vi.fn(async () => undefined),
            removeFile: vi.fn(async (filePath: string) => {
                ledger.push(`remove ${filePath}`);
            }),
            ...overrides,
        },
    };
};

const record = (id: number, outputPath: string | null, parentDir = 'synthetic') => ({
    createdAt: id,
    id,
    option: { mode: 'synthetic-mode', parentDir, recordedId: 1, removeOriginal: false, sourceVideoFileId: 1 },
    outputPath,
});

const makeCleanup = (entries: readonly Entry[], overrides: Record<string, unknown> = {}) => {
    const { ledger, system } = makeSystem(overrides.system as Record<string, unknown> | undefined);
    const logger = { error: vi.fn(), info: vi.fn() };
    const deps = {
        encodeQueue: { list: vi.fn(async () => [record(51, 'synthetic-root/out-51.mp4')]) },
        getParentDirPath: vi.fn((name: string) => (name === 'synthetic' ? 'synthetic-root' : null)),
        hlsArtifacts: {
            deleteAllArtifacts: vi.fn(async () => {
                ledger.push('delete-hls');
            }),
        },
        logger,
        processes: { takeEntries: vi.fn(async () => entries) },
        recordedUse: { releasePeer: vi.fn(() => ledger.push('release-leases')) },
        removeInterruptedOutput: true,
        streamFilePath: 'synthetic-stream-root',
        ...overrides,
        system,
    };
    return { cleanup: new Cleanup(deps), deps, ledger, logger, system };
};

const encodeEntry = (pid: number, encodeId: number): Entry => ({ encodeId, kind: 'encode', pid, startTime: `start-${pid}` });

afterEach(() => {
    vi.useRealTimers();
});

describe('ServiceChildTerminationCleanup (unittest/imp)', () => {
    it('[AR-9.4] keeps going when the encode request records cannot be read', async () => {
        const failure = new Error('synthetic list failure');
        const { cleanup, ledger, logger } = makeCleanup([encodeEntry(9501, 51)], {
            encodeQueue: { list: vi.fn(async () => Promise.reject(failure)) },
        });

        await cleanup.run({});

        expect(ledger).toEqual(['signal 9501 SIGINT', 'delete-hls', 'release-leases']);
        expect(logger.error).toHaveBeenCalledWith('failed to read the encode request records of the ended service child');
        expect(logger.error).toHaveBeenCalledWith(failure);
    });

    it('[AR-9.4] deletes nothing for a missing record, a record without output, an unknown parent, or the parent itself', async () => {
        const { cleanup, ledger, logger } = makeCleanup(
            [encodeEntry(9511, 61), encodeEntry(9512, 62), encodeEntry(9513, 63), encodeEntry(9514, 64)],
            {
                encodeQueue: {
                    list: vi.fn(async () => [
                        record(62, null),
                        record(63, 'synthetic-other/out.mp4', 'synthetic-unknown'),
                        record(64, 'synthetic-root'),
                    ]),
                },
            },
        );

        await cleanup.run({});

        expect(ledger.filter(line => line.startsWith('remove'))).toEqual([]);
        expect(logger.info).toHaveBeenCalledWith(
            'interrupted encode output is kept because it is outside the parent directory: 63',
        );
        expect(logger.info).toHaveBeenCalledWith(
            'interrupted encode output is kept because it is outside the parent directory: 64',
        );
    });

    it('[AR-9.4] records an output that cannot be deleted and an HLS deletion failure, then still releases the leases', async () => {
        const removeFailure = new Error('synthetic remove failure');
        const hlsFailure = new Error('synthetic hls failure');
        const { cleanup, ledger, logger } = makeCleanup([encodeEntry(9521, 51)], {
            hlsArtifacts: { deleteAllArtifacts: vi.fn(async () => Promise.reject(hlsFailure)) },
            system: { removeFile: vi.fn(async () => Promise.reject(removeFailure)) },
        });

        await cleanup.run({});

        expect(ledger).toEqual(['signal 9521 SIGINT', 'release-leases']);
        expect(logger.error).toHaveBeenCalledWith('failed to delete the interrupted encode output: synthetic-root/out-51.mp4');
        expect(logger.error).toHaveBeenCalledWith(removeFailure);
        expect(logger.error).toHaveBeenCalledWith(
            'failed to delete the HLS artifacts of the ended service child: synthetic-stream-root',
        );
        expect(logger.error).toHaveBeenCalledWith(hlsFailure);
        expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('deleted the interrupted encode output'));
    });

    it('[AR-9.4] logs a deleted output', async () => {
        const { cleanup, logger } = makeCleanup([encodeEntry(9522, 51)]);

        await cleanup.run({});

        expect(logger.info).toHaveBeenCalledWith(
            'deleted the interrupted encode output of the ended service child: synthetic-root/out-51.mp4',
        );
    });

    it('[AR-9.4] treats a failed group probe as still running and records a signal that cannot be sent', async () => {
        const probeFailure = new Error('synthetic probe failure');
        const sendFailure = new Error('synthetic send failure');
        const { cleanup, logger, system } = makeCleanup(
            [{ kind: 'hls', pgid: 9531, pid: 9531, startTime: null, streamId: 2 }],
            {
                system: {
                    isGroupAlive: vi.fn(() => {
                        throw probeFailure;
                    }),
                    signalGroup: vi.fn(() => {
                        throw sendFailure;
                    }),
                },
            },
        );

        await cleanup.run({});

        expect(system.signalGroup).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenCalledWith({
            error: probeFailure,
            kind: 'hls',
            pgid: 9531,
            pid: 9531,
            stage: 'initial-check',
        });
        expect(logger.error).toHaveBeenCalledWith({
            error: sendFailure,
            kind: 'hls',
            pgid: 9531,
            pid: 9531,
            stage: 'SIGINT-send',
        });
        expect(logger.error).toHaveBeenCalledWith({
            kind: 'hls',
            pgid: 9531,
            pid: 9531,
            sentSignals: [],
            terminalConfirmed: false,
        });
    });

    it('[AR-8.12] deletes no output when the cap passes while the records are being read', async () => {
        vi.useFakeTimers();
        let resolveList: (records: unknown[]) => void = () => undefined;
        const { cleanup, deps, ledger } = makeCleanup([encodeEntry(9541, 51)], {
            encodeQueue: {
                list: vi.fn(
                    () =>
                        new Promise<unknown[]>(resolve => {
                            resolveList = resolve;
                        }),
                ),
            },
        });

        const run = cleanup.run({});
        await vi.advanceTimersByTimeAsync(30_000);
        await run;
        resolveList([record(51, 'synthetic-root/out-51.mp4')]);
        await vi.runAllTimersAsync();

        expect(ledger).toEqual(['signal 9541 SIGINT', 'release-leases']);
        expect(deps.recordedUse.releasePeer).toHaveBeenCalledOnce();
    });
});
