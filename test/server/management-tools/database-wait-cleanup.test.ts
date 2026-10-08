import { describe, expect, it, vi } from 'vitest';
import { deferred, load } from './_harness';

const ConnectionCheckModel = load<new (...args: any[]) => any>('model', 'ConnectionCheckModel.js');
const RuleDB = load<new (...args: any[]) => any>('model', 'db', 'RuleDB.js');
const Util = load<Record<string, any>>('util', 'Util.js');

describe('management wait and cleanup characterization', () => {
    it('[IMP-CHAR-MT-7.2:pending-unbounded-one-second-cleanup-race] characterizes 0/1/N retries, unbounded pending probe, and cleanup race', async () => {
        const sleep = vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        try {
            const immediateConnection = vi.fn().mockResolvedValue(undefined);
            const immediate = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                {},
                { checkConnection: immediateConnection },
            );
            await immediate.checkDB();
            expect(immediateConnection).toHaveBeenCalledOnce();
            expect(sleep).not.toHaveBeenCalled();

            sleep.mockClear();
            const oneFailureConnection = vi
                .fn()
                .mockRejectedValueOnce(new Error('synthetic retry 1'))
                .mockResolvedValue(undefined);
            const oneFailure = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                {},
                { checkConnection: oneFailureConnection },
            );
            await oneFailure.checkDB();
            expect(oneFailureConnection).toHaveBeenCalledTimes(2);
            expect(sleep.mock.calls).toEqual([[1000]]);

            sleep.mockClear();
            const finiteConnection = vi
                .fn()
                .mockRejectedValueOnce(new Error('synthetic retry 1'))
                .mockRejectedValueOnce(new Error('synthetic retry 2'))
                .mockRejectedValueOnce(new Error('synthetic retry 3'))
                .mockResolvedValue(undefined);
            const finite = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                {},
                { checkConnection: finiteConnection },
            );
            await finite.checkDB();
            expect(finiteConnection).toHaveBeenCalledTimes(4);
            expect(sleep.mock.calls).toEqual([[1000], [1000], [1000]]);

            sleep.mockClear();
            vi.useFakeTimers();
            const pendingProbe = deferred<void>();
            const pendingConnection = vi.fn(() => pendingProbe.promise);
            const pending = new ConnectionCheckModel(
                { getLogger: () => ({ system: { info: vi.fn() } }) },
                {},
                { checkConnection: pendingConnection },
            ).checkDB();
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(86_400_000);
            expect(pendingConnection).toHaveBeenCalledOnce();
            expect(sleep).not.toHaveBeenCalled();
            pendingProbe.resolve();
            await expect(pending).resolves.toBeUndefined();
            expect(pendingConnection).toHaveBeenCalledOnce();
            await assertCleanupRace();
        } finally {
            vi.useRealTimers();
            sleep.mockRestore();
        }
    });

    const assertCleanupRace = async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const events: string[] = [];
            const runner = {
                isTransactionActive: true,
                startTransaction: vi.fn(async () => events.push('start')),
                commitTransaction: vi.fn(async () => events.push('commit')),
                rollbackTransaction: vi.fn(async () => {
                    events.push('rollback');
                    throw new Error('synthetic rollback cleanup failure');
                }),
                release: vi.fn(async () => {
                    events.push('release');
                    throw new Error('synthetic release cleanup failure');
                }),
                manager: {
                    createQueryBuilder: vi.fn(() => ({
                        delete: vi.fn().mockReturnThis(),
                        from: vi.fn().mockReturnThis(),
                        execute: vi.fn(async () => {
                            events.push('delete');
                            throw new Error('synthetic transaction failure');
                        }),
                    })),
                    insert: vi.fn(),
                },
            };
            const repository = new RuleDB(
                { getConnection: vi.fn(async () => ({ createQueryRunner: () => runner })) },
                { run: vi.fn() },
            );
            await expect(repository.restore([])).rejects.toThrow('restore error');
            expect(events).toEqual(['start', 'delete', 'rollback', 'release']);
            expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
            expect(runner.release).toHaveBeenCalledOnce();

            const startFailureRunner = {
                isTransactionActive: false,
                startTransaction: vi.fn(async () => {
                    throw new Error('synthetic start failure');
                }),
                rollbackTransaction: vi.fn(),
                release: vi.fn(async () => undefined),
                manager: { delete: vi.fn(), insert: vi.fn() },
            };
            const startFailureRepository = new RuleDB(
                { getConnection: vi.fn(async () => ({ createQueryRunner: () => startFailureRunner })) },
                { run: vi.fn() },
            );
            await expect(startFailureRepository.restore([])).rejects.toThrow('restore error');
            expect(startFailureRunner.manager.delete).not.toHaveBeenCalled();
            expect(startFailureRunner.rollbackTransaction).not.toHaveBeenCalled();
            expect(startFailureRunner.release).toHaveBeenCalledOnce();
        } finally {
            error.mockRestore();
        }
    };
});
