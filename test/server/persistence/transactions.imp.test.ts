import { describe, expect, it, vi } from 'vitest';

import { makeReserve } from '../reservation-management/_harness';
import { loadCompiled, repositoryOperator } from './repository-harness';

const ReserveDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ReserveDB.js');

// The runner double tracks `isTransactionActive` the same way the real TypeORM QueryRunner
// does (true only between a successful startTransaction() and the next commit/rollback), because
// ReserveDB.updateMany() (src/model/db/ReserveDB.ts) gates its rollback attempt on that flag. A
// double that always reports `isTransactionActive === undefined` never exercises the rollback
// branch and produces false failures unrelated to the production contract (see
// repositories.spec.test.ts's `transactionRunner()` for the shared realistic-double pattern this
// mirrors).
const makeFaultHarness = (fault: 'commit' | 'mutation' | 'release' | 'rollback' | 'start') => {
    const primary = new Error(`synthetic-${fault}-failure`);
    const rollbackFailure = new Error('synthetic-rollback-cleanup-failure');
    const releaseFailure = new Error('synthetic-release-cleanup-failure');
    let active = false;
    const runner = {
        startTransaction: vi.fn(async () => {
            if (fault === 'start') throw primary;
            active = true;
        }),
        get isTransactionActive() {
            return active;
        },
        manager: {
            delete: vi.fn(async () => {
                if (fault === 'mutation') throw primary;
            }),
            insert: vi.fn(async () => ({ identifiers: [{ id: 1 }] })),
            update: vi.fn(async () => undefined),
        },
        commitTransaction: vi.fn(async () => {
            if (fault === 'commit') throw primary;
            active = false;
        }),
        rollbackTransaction: vi.fn(async () => {
            if (fault === 'rollback') throw rollbackFailure;
            active = false;
        }),
        release: vi.fn(async () => {
            if (fault === 'release') throw releaseFailure;
        }),
    };
    const connection = { createQueryRunner: vi.fn(() => runner) };
    const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
    const repository = new ReserveDB(repositoryOperator(connection), retry);
    return { primary, releaseFailure, repository, retry, rollbackFailure, runner };
};

describe('isolated transaction lifecycle characterization', () => {
    it('[PERSIST-3.1-START] releases an inactive runner and wraps a start failure as ReserveUpdateManyError without entering common retry', async () => {
        const harness = makeFaultHarness('start');
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(harness.repository.updateMany({ delete: [makeReserve({ id: 1 })] })).rejects.toThrow(
            'ReserveUpdateManyError',
        );
        expect(harness.runner.startTransaction).toHaveBeenCalledOnce();
        expect(harness.runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(harness.runner.release).toHaveBeenCalledOnce();
        expect(harness.retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(harness.primary);
    });

    it.each(['mutation', 'commit'] as const)(
        '[PERSIST-3.1-CLEANUP-%s] rolls an active failed attempt back, releases once, and returns the operation wrapper',
        async fault => {
            const harness = makeFaultHarness(fault);
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            await expect(harness.repository.updateMany({ delete: [makeReserve({ id: 1 })] })).rejects.toThrow(
                'ReserveUpdateManyError',
            );
            expect(harness.runner.startTransaction).toHaveBeenCalledOnce();
            expect(harness.runner.rollbackTransaction).toHaveBeenCalledOnce();
            expect(harness.runner.release).toHaveBeenCalledOnce();
            expect(harness.retry.run).not.toHaveBeenCalled();
        },
    );

    it('[PERSIST-3.1-ROLLBACK-CLEANUP] releases once and keeps ReserveUpdateManyError as the public error when rollback cleanup also fails', async () => {
        const harness = makeFaultHarness('rollback');
        harness.runner.manager.delete.mockRejectedValueOnce(harness.primary);
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(harness.repository.updateMany({ delete: [makeReserve({ id: 1 })] })).rejects.toThrow(
            'ReserveUpdateManyError',
        );
        expect(harness.runner.rollbackTransaction).toHaveBeenCalledOnce();
        expect(harness.runner.release).toHaveBeenCalledOnce();
        expect(harness.retry.run).not.toHaveBeenCalled();
        expect(diagnostic.mock.calls).toEqual([[harness.primary], [harness.rollbackFailure]]);
    });

    it('[PERSIST-3.1-RELEASE-CLEANUP] keeps ReserveUpdateManyError as the public error when only release cleanup fails after a committed operation', async () => {
        const harness = makeFaultHarness('release');
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(harness.repository.updateMany({ delete: [makeReserve({ id: 1 })] })).rejects.toThrow(
            'ReserveUpdateManyError',
        );
        expect(harness.runner.commitTransaction).toHaveBeenCalledOnce();
        expect(harness.runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(harness.runner.release).toHaveBeenCalledOnce();
        expect(harness.retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(harness.releaseFailure);
    });
});
