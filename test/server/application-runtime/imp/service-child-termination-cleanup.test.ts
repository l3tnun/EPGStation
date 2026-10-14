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

/** 一度だけ signal を受けて居なくなる process の表。確認の間隔は timer で待つ。 */
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
            hasLiveGroupMember: vi.fn((pgid: number) => !gone.has(pgid)),
            isGroupAlive: vi.fn((pgid: number) => !gone.has(pgid)),
            signal: vi.fn((pid: number, signal: Signal) => {
                ledger.push(`signal ${pid} ${signal}`);
                gone.add(pid);
            }),
            signalGroup: vi.fn((pgid: number, signal: Signal) => {
                ledger.push(`signal-group ${pgid} ${signal}`);
                gone.add(pgid);
            }),
            wait: vi.fn((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))),
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
    option: { mode: 'synthetic-mode', parentDir, recordedId: 1, removeOriginal: false, sourceVideoFileId: 7 },
    outputPath,
});

const recordedFiles = (overrides: Record<string, unknown> = {}) => ({
    recordedDB: {
        findId: vi.fn(async () => ({
            id: 1,
            videoFiles: [
                { fullPath: 'synthetic-root/source.ts', id: 7 },
                { fullPath: null, id: 8 },
            ],
        })),
    },
    videoUtil: {
        getFullFilePathFromVideoFile: vi.fn((videoFile: { fullPath: string | null }) => videoFile.fullPath),
        getParentDirPath: vi.fn((name: string) => (name === 'synthetic' ? 'synthetic-root' : null)),
    },
    ...overrides,
});

const makeCleanup = (entries: readonly Entry[], overrides: Record<string, unknown> = {}) => {
    const { ledger, system } = makeSystem(overrides.system as Record<string, unknown> | undefined);
    const logger = { error: vi.fn(), info: vi.fn() };
    const files = recordedFiles();
    const deps = {
        encodeQueue: { list: vi.fn(async () => [record(51, 'synthetic-root/out-51.mp4')]) },
        hlsArtifacts: {
            deleteAllArtifacts: vi.fn(async () => {
                ledger.push('delete-hls');
            }),
        },
        isSameFile: vi.fn(async () => false),
        logger,
        processes: { takeEntries: vi.fn(async () => entries) },
        recordedUse: { releasePeer: vi.fn(() => ledger.push('release-leases')) },
        removeInterruptedOutput: true,
        resolveRecordedFiles: vi.fn(() => files),
        streamFilePath: 'synthetic-stream-root',
        ...overrides,
        system,
    };
    return { cleanup: new Cleanup(deps), deps, ledger, logger, system };
};

const runToEnd = async (cleanup: { run(peer: object): Promise<void> }, peer: object = {}): Promise<void> => {
    const run = cleanup.run(peer);
    await vi.runAllTimersAsync();
    await run;
};

const encodeEntry = (pid: number, encodeId: number): Entry => ({ encodeId, kind: 'encode', pid, startTime: `start-${pid}` });

afterEach(() => {
    vi.useRealTimers();
});

describe('ServiceChildTerminationCleanup (unittest/imp)', () => {
    it('[AR-9.4] keeps going when the encode request records cannot be read', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic list failure');
        const { cleanup, ledger, logger } = makeCleanup([encodeEntry(9501, 51)], {
            encodeQueue: { list: vi.fn(async () => Promise.reject(failure)) },
        });

        await runToEnd(cleanup);

        expect(ledger).toEqual(['signal 9501 SIGINT', 'delete-hls', 'release-leases']);
        expect(logger.error).toHaveBeenCalledWith('failed to read the encode request records of the ended service child');
        expect(logger.error).toHaveBeenCalledWith(failure);
    });

    it('[AR-9.4] keeps the output when the recorded files cannot be resolved or read', async () => {
        vi.useFakeTimers();
        const resolveFailure = new Error('synthetic resolve failure');
        const findFailure = new Error('synthetic findId failure');
        const unresolved = makeCleanup([encodeEntry(9502, 51)], {
            resolveRecordedFiles: vi.fn(() => {
                throw resolveFailure;
            }),
        });
        const unreadable = makeCleanup([encodeEntry(9503, 51)], {
            resolveRecordedFiles: vi.fn(() =>
                recordedFiles({ recordedDB: { findId: vi.fn(async () => Promise.reject(findFailure)) } }),
            ),
        });

        await runToEnd(unresolved.cleanup);
        await runToEnd(unreadable.cleanup);

        expect(unresolved.ledger).toEqual(['signal 9502 SIGINT', 'delete-hls', 'release-leases']);
        expect(unresolved.logger.error).toHaveBeenCalledWith(resolveFailure);
        expect(unreadable.ledger).toEqual(['signal 9503 SIGINT', 'delete-hls', 'release-leases']);
        expect(unreadable.logger.error).toHaveBeenCalledWith(
            'failed to read the recorded program of the interrupted encode output: 51',
        );
        expect(unreadable.logger.error).toHaveBeenCalledWith(findFailure);
    });

    it('[AR-9.4] deletes nothing for a missing record, a record without output, a missing source, an unknown parent, or the parent itself', async () => {
        vi.useFakeTimers();
        const { cleanup, ledger, logger } = makeCleanup(
            [
                encodeEntry(9511, 61),
                encodeEntry(9512, 62),
                encodeEntry(9513, 63),
                encodeEntry(9514, 64),
                encodeEntry(9515, 65),
            ],
            {
                encodeQueue: {
                    list: vi.fn(async () => [
                        record(62, null),
                        record(63, 'synthetic-other/out.mp4', 'synthetic-unknown'),
                        record(64, 'synthetic-root'),
                        { ...record(65, 'synthetic-root/out-65.mp4'), option: { ...record(65, null).option, sourceVideoFileId: 99 } },
                    ]),
                },
            },
        );

        await runToEnd(cleanup);

        expect(ledger.filter(line => line.startsWith('remove'))).toEqual([]);
        expect(logger.info).toHaveBeenCalledWith(
            'interrupted encode output is kept because it is outside the parent directory: 63',
        );
        expect(logger.info).toHaveBeenCalledWith(
            'interrupted encode output is kept because it is outside the parent directory: 64',
        );
        expect(logger.info).toHaveBeenCalledWith(
            'interrupted encode output is kept because the recorded program or the source file is missing: 65',
        );
    });

    it('[AR-9.4] keeps the output of a recorded program read without its recorded files', async () => {
        vi.useFakeTimers();
        const { cleanup, ledger, logger } = makeCleanup([encodeEntry(9517, 51)], {
            resolveRecordedFiles: vi.fn(() => recordedFiles({ recordedDB: { findId: vi.fn(async () => ({ id: 1 })) } })),
        });

        await runToEnd(cleanup);

        expect(ledger.filter(line => line.startsWith('remove'))).toEqual([]);
        expect(logger.info).toHaveBeenCalledWith(
            'interrupted encode output is kept because the recorded program or the source file is missing: 51',
        );
    });

    it('[AR-9.4] keeps an output registered as a recorded file by full path and logs it', async () => {
        vi.useFakeTimers();
        const { cleanup, ledger, logger } = makeCleanup([encodeEntry(9516, 51)], {
            encodeQueue: { list: vi.fn(async () => [record(51, 'synthetic-root/source.ts')]) },
        });

        await runToEnd(cleanup);

        expect(ledger.filter(line => line.startsWith('remove'))).toEqual([]);
        expect(logger.info).toHaveBeenCalledWith('interrupted encode output is a registered recorded file: 51');
    });

    it('[AR-9.4] records an output that cannot be deleted and an HLS deletion failure, then still releases the leases', async () => {
        vi.useFakeTimers();
        const removeFailure = new Error('synthetic remove failure');
        const hlsFailure = new Error('synthetic hls failure');
        const { cleanup, ledger, logger } = makeCleanup([encodeEntry(9521, 51)], {
            hlsArtifacts: { deleteAllArtifacts: vi.fn(async () => Promise.reject(hlsFailure)) },
            system: { removeFile: vi.fn(async () => Promise.reject(removeFailure)) },
        });

        await runToEnd(cleanup);

        expect(ledger).toEqual(['signal 9521 SIGINT', 'release-leases']);
        expect(logger.error).toHaveBeenCalledWith('failed to delete the interrupted encode output: synthetic-root/out-51.mp4');
        expect(logger.error).toHaveBeenCalledWith(removeFailure);
        expect(logger.error).toHaveBeenCalledWith(
            'failed to delete the HLS artifacts of the ended service child: synthetic-stream-root',
        );
        expect(logger.error).toHaveBeenCalledWith(hlsFailure);
    });

    it('[AR-9.4] logs a deleted output', async () => {
        vi.useFakeTimers();
        const { cleanup, logger } = makeCleanup([encodeEntry(9522, 51)]);

        await runToEnd(cleanup);

        expect(logger.info).toHaveBeenCalledWith(
            'deleted the interrupted encode output of the ended service child: synthetic-root/out-51.mp4',
        );
    });

    it('[AR-9.4] treats a failed group probe as still running and records a signal that cannot be sent', async () => {
        vi.useFakeTimers();
        const probeFailure = new Error('synthetic probe failure');
        const sendFailure = new Error('synthetic send failure');
        const { cleanup, logger, system } = makeCleanup(
            [{ kind: 'hls', pgid: 9531, pid: 9531, startTime: null, streamId: 2 }],
            {
                system: {
                    hasLiveGroupMember: vi.fn(() => {
                        throw probeFailure;
                    }),
                    signalGroup: vi.fn(() => {
                        throw sendFailure;
                    }),
                },
            },
        );

        await runToEnd(cleanup);

        expect(system.signalGroup).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenCalledWith({
            error: probeFailure,
            kind: 'hls',
            pgid: 9531,
            pid: 9531,
            stage: 'initial-check',
        });
        expect(logger.error).toHaveBeenCalledWith({
            error: probeFailure,
            kind: 'hls',
            pgid: 9531,
            pid: 9531,
            stage: 'after-stop-check',
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

    it('[AR-9.4] records a lease release that throws and still resolves', async () => {
        vi.useFakeTimers();
        const failure = new Error('synthetic release failure');
        const { cleanup, logger } = makeCleanup([], {
            recordedUse: {
                releasePeer: vi.fn(() => {
                    throw failure;
                }),
            },
        });

        await expect(runToEnd(cleanup)).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith('failed to release the recorded-use leases of the ended service child');
        expect(logger.error).toHaveBeenCalledWith(failure);
    });
});
