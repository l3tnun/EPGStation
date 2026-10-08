import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeProgram, makeRule } from '../fixtures/reservation-rules/runtime';
import { makeReserve } from '../reservation-management/_harness';
import { MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS, provisionMySql, type MySqlRuntime } from './mysql-runtime';
import { createRepositoryPersistence, type RepositoryPersistence } from './repository-harness';

let mysqlRuntime: MySqlRuntime;

beforeAll(async () => {
    mysqlRuntime = await provisionMySql();
}, MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS);

afterAll(async () => {
    await mysqlRuntime.cleanup();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const withDialects = async (run: (fixture: RepositoryPersistence) => Promise<void>) => {
    for (const dialect of ['sqlite', 'mysql'] as const) {
        const fixture = await createRepositoryPersistence(dialect, mysqlRuntime);
        try {
            await run(fixture);
        } finally {
            await fixture.cleanup();
        }
    }
};

const tunerProgram = (id: number) => ({
    id,
    eventId: id,
    serviceId: 11,
    networkId: 1,
    startAt: id * 1_000,
    duration: 1_000,
    isFree: true,
    name: `synthetic-${id}`,
});

const channelIndex = { 1: { 11: { id: 11, type: 'GR', channel: 'synthetic-11' } } };

const tunerChannel = (id: number) => ({
    id,
    serviceId: id,
    networkId: 1,
    name: `synthetic-channel-${id}`,
    channel: { type: 'GR' as const, channel: `synthetic-${id}` },
});

const recorded = (id: number) => ({
    id,
    reserveId: null,
    ruleId: null,
    programId: null,
    channelId: 10,
    isProtected: false,
    startAt: id * 100,
    endAt: id * 100 + 50,
    duration: 50,
    name: `recorded-${id}`,
    halfWidthName: `recorded-${id}`,
    rawExtended: null,
    rawHalfWidthExtended: null,
    isRecording: false,
    dropLogFileId: null,
});

const restoreCases = [
    { repo: 'RuleDB', entity: 'Rule', make: (id: number) => makeRule({ id }) },
    { repo: 'ReserveDB', entity: 'Reserve', make: (id: number) => makeReserve({ id, programId: id }) },
    {
        repo: 'DropLogFileDB',
        entity: 'DropLogFile',
        make: (id: number) => ({ id, errorCnt: 0, dropCnt: 0, scramblingCnt: 0, filePath: `drop-${id}` }),
    },
    { repo: 'RecordedDB', entity: 'Recorded', make: recorded },
    {
        repo: 'ThumbnailDB',
        entity: 'Thumbnail',
        make: (id: number) => ({ id, filePath: `thumbnail-${id}`, recordedId: id }),
    },
    {
        repo: 'VideoFileDB',
        entity: 'VideoFile',
        make: (id: number) => ({
            id,
            parentDirectoryName: 'synthetic',
            filePath: `video-${id}`,
            type: 'ts',
            name: `video-${id}`,
            size: 0,
            recordedId: id,
        }),
    },
    {
        repo: 'RecordedHistoryDB',
        entity: 'RecordedHistory',
        make: (id: number) => ({ id, name: `history-${id}`, channelId: 1, endAt: id }),
    },
    {
        repo: 'RecordedTagDB',
        entity: 'RecordedTag',
        make: (id: number) => ({ id, name: `tag-${id}`, halfWidthName: `tag-${id}`, color: '#000000' }),
    },
] as const;

type RestoreFault = 'start' | 'mutation' | 'commit' | 'rollback' | 'release';

const installRestoreFault = (source: any, fault: RestoreFault) => {
    const primary = new Error(`synthetic-${fault}-primary`);
    const cleanup = new Error(`synthetic-${fault}-cleanup`);
    const originalFactory = source.createQueryRunner.bind(source);
    let runner: any;
    let activeAtFault = false;
    let releasedAtFault: boolean | undefined;
    let recover = async () => undefined;

    vi.spyOn(source, 'createQueryRunner').mockImplementation((mode?: any) => {
        runner = originalFactory(mode);
        const originalStart = runner.startTransaction.bind(runner);
        const originalRollback = runner.rollbackTransaction.bind(runner);
        const originalRelease = runner.release.bind(runner);
        const startTransaction = vi.spyOn(runner, 'startTransaction');
        const commitTransaction = vi.spyOn(runner, 'commitTransaction');
        const rollbackTransaction = vi.spyOn(runner, 'rollbackTransaction');
        const release = vi.spyOn(runner, 'release');

        if (fault === 'start') {
            startTransaction.mockImplementation(async () => {
                await originalStart();
                activeAtFault = runner.isTransactionActive;
                throw primary;
            });
        }
        if (fault === 'mutation' || fault === 'rollback') {
            // 呼び出し元ごとに削除経路が異なる: 空 criteria を含み得る全件削除（restore()、ChannelDB.insert()）は
            // TypeORM 1.x が `manager.delete` の空 criteria を拒否するため
            // `manager.createQueryBuilder().delete().from(Entity).execute()` へ置き換え済み。一方
            // ReserveDB.updateMany() の個別 ID 削除は criteria が非空のため従来どおり `manager.delete` を使う。
            // どちらの経路が使われても fault を注入できるよう、両方へ仕掛ける。
            vi.spyOn(runner.manager, 'delete').mockImplementation(async () => {
                activeAtFault = runner.isTransactionActive;
                throw primary;
            });
            // `.delete()` はレジストリ経由で新しい `DeleteQueryBuilder` インスタンスを作るため
            // `createQueryBuilder()` の戻り値へ直接 `execute` を仕込んでも届かない。かといって共通の
            // `DeleteQueryBuilder.prototype.execute` へ仕込むと、integration 層は module を isolate
            // せず同じ 'typeorm' module を全 file で共有するため、他の test file の同時実行へ波及しうる。
            // instance 固有の `runner.manager.createQueryBuilder` を、実際の delete チェーンを再現しない
            // 最小限の fluent stub で丸ごと差し替えることで、instance の外へ影響を漏らさず fault を注入する。
            vi.spyOn(runner.manager, 'createQueryBuilder').mockImplementation(() => {
                const fluent: any = {
                    delete: () => fluent,
                    from: () => fluent,
                    execute: async () => {
                        activeAtFault = runner.isTransactionActive;
                        throw primary;
                    },
                };
                return fluent;
            });
        }
        if (fault === 'commit') {
            commitTransaction.mockImplementation(async () => {
                activeAtFault = runner.isTransactionActive;
                throw primary;
            });
        }
        if (fault === 'rollback') {
            rollbackTransaction.mockImplementation(async () => {
                activeAtFault = runner.isTransactionActive;
                throw cleanup;
            });
        }
        if (fault === 'release') {
            release.mockImplementation(async () => {
                activeAtFault = runner.isTransactionActive;
                releasedAtFault = runner.isReleased;
                throw cleanup;
            });
        }

        recover = async () => {
            if (!runner.isReleased && runner.isTransactionActive) {
                await originalRollback();
                await runner.release();
            }
            if (fault === 'release') await originalRelease();
        };

        return runner;
    });

    return {
        cleanup,
        get runner() {
            return runner;
        },
        get activeAtFault() {
            return activeAtFault;
        },
        get releasedAtFault() {
            return releasedAtFault;
        },
        primary,
        recover: () => recover(),
    };
};

type ProgramInsertPrimaryFault = 'start' | 'mutation' | 'commit';
type ProgramInsertCleanupFault = 'rollback' | 'release';

const installProgramInsertFault = (
    source: any,
    {
        cleanupFault,
        primaryFault,
    }: { cleanupFault?: ProgramInsertCleanupFault; primaryFault?: ProgramInsertPrimaryFault },
) => {
    const primary = new Error(`synthetic-program-insert-${primaryFault ?? 'none'}-primary`);
    const cleanup = new Error(`synthetic-program-insert-${cleanupFault ?? 'none'}-cleanup`);
    const originalFactory = source.createQueryRunner.bind(source);
    let runner: any;
    let activeAtCleanupFault: boolean | undefined;
    let activeAtPrimaryFault: boolean | undefined;
    let releasedAtCleanupFault: boolean | undefined;
    let recover = async () => undefined;

    vi.spyOn(source, 'createQueryRunner').mockImplementation((mode?: any) => {
        runner = originalFactory(mode);
        const originalRollback = runner.rollbackTransaction.bind(runner);
        const originalRelease = runner.release.bind(runner);
        const startTransaction = vi.spyOn(runner, 'startTransaction');
        const commitTransaction = vi.spyOn(runner, 'commitTransaction');
        const rollbackTransaction = vi.spyOn(runner, 'rollbackTransaction');
        const release = vi.spyOn(runner, 'release');

        if (primaryFault === 'start') {
            startTransaction.mockImplementation(async () => {
                activeAtPrimaryFault = runner.isTransactionActive;
                throw primary;
            });
        }
        if (primaryFault === 'mutation') {
            // deleteChannelIds が空のときの ProgramDB.insert は空 criteria を避けるため
            // `manager.createQueryBuilder().delete().from(Program).execute()` を使う（`manager.delete`
            // ではない）。このハーネスは deleteChannelIds を渡さない呼び出しにだけ使われるため、
            // その経路へ fault を注入する。
            vi.spyOn(runner.manager, 'delete').mockImplementation(async () => {
                activeAtPrimaryFault = runner.isTransactionActive;
                throw primary;
            });
            vi.spyOn(runner.manager, 'createQueryBuilder').mockImplementation(() => {
                const fluent: any = {
                    delete: () => fluent,
                    from: () => fluent,
                    execute: async () => {
                        activeAtPrimaryFault = runner.isTransactionActive;
                        throw primary;
                    },
                };
                return fluent;
            });
        }
        if (primaryFault === 'commit') {
            commitTransaction.mockImplementation(async () => {
                activeAtPrimaryFault = runner.isTransactionActive;
                throw primary;
            });
        }
        if (cleanupFault === 'rollback') {
            rollbackTransaction.mockImplementation(async () => {
                activeAtCleanupFault = runner.isTransactionActive;
                throw cleanup;
            });
        }
        if (cleanupFault === 'release') {
            release.mockImplementation(async () => {
                activeAtCleanupFault = runner.isTransactionActive;
                releasedAtCleanupFault = runner.isReleased;
                throw cleanup;
            });
        }

        recover = async () => {
            if (!runner.isReleased && runner.isTransactionActive) await originalRollback();
            if (!runner.isReleased) await originalRelease();
        };

        return runner;
    });

    return {
        cleanup,
        get runner() {
            return runner;
        },
        get activeAtCleanupFault() {
            return activeAtCleanupFault;
        },
        get activeAtPrimaryFault() {
            return activeAtPrimaryFault;
        },
        get releasedAtCleanupFault() {
            return releasedAtCleanupFault;
        },
        primary,
        recover: () => recover(),
    };
};

type ProgramUpdatePrimaryFault = 'start' | 'mutation' | 'commit';
type ProgramUpdateCleanupFault = 'rollback' | 'release';

const installProgramUpdateFault = (
    source: any,
    {
        cleanupFault,
        primaryFault,
    }: { cleanupFault?: ProgramUpdateCleanupFault; primaryFault?: ProgramUpdatePrimaryFault },
) => {
    const primary = new Error(`synthetic-program-update-${primaryFault ?? 'none'}-primary`);
    const cleanup = new Error(`synthetic-program-update-${cleanupFault ?? 'none'}-cleanup`);
    const originalFactory = source.createQueryRunner.bind(source);
    let runner: any;
    let activeAtCleanupFault: boolean | undefined;
    let activeAtPrimaryFault: boolean | undefined;
    let releasedAtCleanupFault: boolean | undefined;
    let recover = async () => undefined;

    vi.spyOn(source, 'createQueryRunner').mockImplementation((mode?: any) => {
        runner = originalFactory(mode);
        const originalRollback = runner.rollbackTransaction.bind(runner);
        const originalRelease = runner.release.bind(runner);
        const startTransaction = vi.spyOn(runner, 'startTransaction');
        const commitTransaction = vi.spyOn(runner, 'commitTransaction');
        const rollbackTransaction = vi.spyOn(runner, 'rollbackTransaction');
        const release = vi.spyOn(runner, 'release');

        if (primaryFault === 'start') {
            startTransaction.mockImplementation(async () => {
                activeAtPrimaryFault = runner.isTransactionActive;
                throw primary;
            });
        }
        if (primaryFault === 'mutation') {
            vi.spyOn(runner.manager, 'delete').mockImplementation(async () => {
                activeAtPrimaryFault = runner.isTransactionActive;
                throw primary;
            });
        }
        if (primaryFault === 'commit') {
            commitTransaction.mockImplementation(async () => {
                activeAtPrimaryFault = runner.isTransactionActive;
                throw primary;
            });
        }
        if (cleanupFault === 'rollback') {
            rollbackTransaction.mockImplementation(async () => {
                activeAtCleanupFault = runner.isTransactionActive;
                throw cleanup;
            });
        }
        if (cleanupFault === 'release') {
            release.mockImplementation(async () => {
                activeAtCleanupFault = runner.isTransactionActive;
                releasedAtCleanupFault = runner.isReleased;
                throw cleanup;
            });
        }

        recover = async () => {
            if (!runner.isReleased && runner.isTransactionActive) await originalRollback();
            if (!runner.isReleased) await originalRelease();
        };

        return runner;
    });

    return {
        cleanup,
        get runner() {
            return runner;
        },
        get activeAtCleanupFault() {
            return activeAtCleanupFault;
        },
        get activeAtPrimaryFault() {
            return activeAtPrimaryFault;
        },
        get releasedAtCleanupFault() {
            return releasedAtCleanupFault;
        },
        primary,
        recover: () => recover(),
    };
};

describe('atomic transaction characterization through real drivers', () => {
    it('[PERSIST-3.1-PROGRAM-SUCCESS] commits both full and per-channel program replacement', async () => {
        await withDialects(async ({ db, entities, retry, source }) => {
            const programs = source.getRepository(entities.Program);
            await programs.insert([
                makeProgram({ id: 401, channelId: 11, name: 'full-replace-target' }),
                makeProgram({ id: 402, channelId: 12, name: 'full-replace-other-channel' }),
            ]);
            const retryBefore = retry.calls;
            await db.ProgramDB.insert(channelIndex, [tunerProgram(403)]);
            expect((await programs.find({ order: { id: 'ASC' } })).map(row => Number(row.id))).toEqual([403]);

            await programs.insert(makeProgram({ id: 404, channelId: 12, name: 'per-channel-preserved' }));
            await db.ProgramDB.insert(channelIndex, [tunerProgram(405)], [11]);
            expect((await programs.find({ order: { id: 'ASC' } })).map(row => Number(row.id))).toEqual([404, 405]);
            expect(retry.calls).toBe(retryBefore);
        });
    });

    it('[PERSIST-3.1-SUCCESS] commits complete reserve delete/insert/update batches without common retry', async () => {
        await withDialects(async ({ db, entities, retry, source }) => {
            await source
                .getRepository(entities.Reserve)
                .insert([
                    makeReserve({ id: 501, programId: 501, name: 'delete-target' }),
                    makeReserve({ id: 502, programId: 502, name: 'update-target' }),
                ]);
            const retryBefore = retry.calls;
            await db.ReserveDB.updateMany({
                delete: [makeReserve({ id: 501 })],
                insert: [makeReserve({ id: 503, programId: 503, name: 'inserted' })],
                update: [makeReserve({ id: 502, programId: 502, name: 'updated' })],
            });
            const rows = await source.getRepository(entities.Reserve).find({ order: { id: 'ASC' } });
            expect(rows.map(row => ({ id: row.id, name: row.name }))).toEqual([
                { id: 502, name: 'updated' },
                { id: 503, name: 'inserted' },
            ]);
            expect(retry.calls).toBe(retryBefore);
        });
    });

    it.each(['first', 'middle', 'last'] as const)(
        '[PERSIST-3.1-PROGRAM-%s] rolls program replacement back and preserves InsertError without retry',
        async position => {
            await withDialects(async ({ db, entities, retry, source }) => {
                await source
                    .getRepository(entities.Program)
                    .insert([
                        makeProgram({ id: 500, channelId: 11, name: 'old-target' }),
                        makeProgram({ id: 900, channelId: 12, name: 'duplicate-guard' }),
                    ]);
                const positions = {
                    first: [900, 901, 902],
                    middle: [901, 900, 902],
                    last: [901, 902, 900],
                };
                const retryBefore = retry.calls;
                await expect(
                    db.ProgramDB.insert(channelIndex, positions[position].map(tunerProgram), [11]),
                ).rejects.toThrow('InsertError');
                const rows = await source.getRepository(entities.Program).find({ order: { id: 'ASC' } });
                expect(rows.map(row => Number(row.id))).toEqual([500, 900]);
                expect(retry.calls).toBe(retryBefore);
            });
        },
    );

    it('[PERSIST-4.8-4.9-PROGRAM-INSERT-LIFECYCLE] keeps InsertError across primary and cleanup fault combinations', async () => {
        for (const { cleanupFault, primaryFault } of [
            { primaryFault: 'start' },
            { primaryFault: 'mutation' },
            { primaryFault: 'commit' },
            { cleanupFault: 'rollback', primaryFault: 'mutation' },
            { cleanupFault: 'release' },
            { cleanupFault: 'release', primaryFault: 'start' },
            { cleanupFault: 'release', primaryFault: 'mutation' },
            { cleanupFault: 'release', primaryFault: 'commit' },
            { cleanupFault: 'rollback', primaryFault: 'commit' },
        ] as const) {
            await withDialects(async ({ db, dialect, entities, logMessages, retry, source }) => {
                const previousId = 851;
                const replacementId = 852;
                await source
                    .getRepository(entities.Program)
                    .insert(makeProgram({ id: previousId, channelId: 11, name: 'program-insert-previous' }));

                const retryBefore = retry.calls;
                const faultHarness = installProgramInsertFault(source, { cleanupFault, primaryFault });
                const logBefore = logMessages.length;

                let rejection: unknown;
                try {
                    await db.ProgramDB.insert(channelIndex, [tunerProgram(replacementId)]);
                } catch (error) {
                    rejection = error;
                }
                const lifecycle = {
                    release: faultHarness.runner.release.mock.calls.length,
                    rollback: faultHarness.runner.rollbackTransaction.mock.calls.length,
                    start: faultHarness.runner.startTransaction.mock.calls.length,
                };
                const diagnostics = logMessages.slice(logBefore);
                const activeAfterInsert = faultHarness.runner.isTransactionActive;
                vi.restoreAllMocks();
                await faultHarness.recover();

                expect(
                    rejection,
                    `ProgramDB.insert/${primaryFault ?? 'success'}/${cleanupFault ?? 'none'}`,
                ).toBeInstanceOf(Error);
                expect((rejection as Error).message).toBe('InsertError');
                expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
                expect(lifecycle.start).toBe(1);
                expect(lifecycle.release).toBe(1);
                expect(lifecycle.rollback).toBe(['mutation', 'commit'].includes(primaryFault ?? '') ? 1 : 0);
                expect(faultHarness.activeAtPrimaryFault).toBe(
                    primaryFault === undefined ? undefined : primaryFault !== 'start',
                );
                expect(faultHarness.activeAtCleanupFault).toBe(
                    cleanupFault === undefined ? undefined : cleanupFault === 'rollback',
                );
                expect(faultHarness.releasedAtCleanupFault).toBe(cleanupFault === 'release' ? false : undefined);
                expect(activeAfterInsert).toBe(cleanupFault === 'rollback');
                expect(retry.calls).toBe(retryBefore);

                const rows = await source.getRepository(entities.Program).find({ order: { id: 'ASC' } });
                const expectedRows =
                    primaryFault === undefined ||
                    (primaryFault === 'commit' && cleanupFault === 'rollback' && dialect === 'mysql')
                        ? [replacementId]
                        : [previousId];
                expect(
                    rows.map(row => Number(row.id)),
                    `ProgramDB.insert/${primaryFault ?? 'success'}/${cleanupFault ?? 'none'}/${dialect} rows`,
                ).toEqual(expectedRows);
                expect(diagnostics).toEqual([
                    ...(primaryFault === undefined ? [] : [faultHarness.primary]),
                    ...(cleanupFault === undefined ? [] : [faultHarness.cleanup]),
                ]);
            });
        }
    }, 120_000);

    it.each(['first', 'middle', 'last'] as const)(
        '[PERSIST-3.1-RESERVE-%s] rolls reserve batches back and preserves ReserveUpdateManyError without retry',
        async position => {
            await withDialects(async ({ db, entities, retry, source }) => {
                await source
                    .getRepository(entities.Reserve)
                    .insert([makeReserve({ id: 500, programId: 500 }), makeReserve({ id: 900, programId: 900 })]);
                const positions = {
                    first: [900, 901, 902],
                    middle: [901, 900, 902],
                    last: [901, 902, 900],
                };
                const retryBefore = retry.calls;
                await expect(
                    db.ReserveDB.updateMany({
                        delete: [makeReserve({ id: 500 })],
                        insert: positions[position].map(id => makeReserve({ id, programId: id })),
                    }),
                ).rejects.toThrow('ReserveUpdateManyError');
                const rows = await source.getRepository(entities.Reserve).find({ order: { id: 'ASC' } });
                expect(rows.map(row => row.id)).toEqual([500, 900]);
                expect(retry.calls).toBe(retryBefore);
            });
        },
    );

    for (const restoreCase of restoreCases) {
        it(
            `[PERSIST-3.2-${restoreCase.repo}] rolls ${restoreCase.repo} restore back independently and keeps the established restore error`,
            async () => {
                await withDialects(async ({ db, entities, retry, source }) => {
                    if (restoreCase.entity === 'Thumbnail' || restoreCase.entity === 'VideoFile') {
                        await source.getRepository(entities.Recorded).insert([recorded(1), recorded(2)]);
                    }
                    const repository = db[restoreCase.repo];
                    await repository.restore([restoreCase.make(1)]);
                    const retryBefore = retry.calls;
                        await expect(repository.restore([restoreCase.make(2), restoreCase.make(2)])).rejects.toThrow(
                        'restore error',
                    );
                    const rows = await source
                        .getRepository(entities[restoreCase.entity])
                        .find({ order: { id: 'ASC' } });
                    expect(rows.map(row => row.id)).toEqual([1]);
                    expect(retry.calls).toBe(retryBefore);
                });
            },
            60_000,
        );
    }

    it('[PERSIST-4.8-4.9-RESTORE-LIFECYCLE] keeps restore wrappers while active and pre-cleanup faults leave the next connection usable', async () => {
        for (const restoreCase of restoreCases) {
            for (const fault of ['start', 'mutation', 'commit', 'rollback', 'release'] as const) {
                await withDialects(async ({ db, entities, logMessages, retry, source }) => {
                    const previousId = 801;
                    const restoredId = 802;
                    if (restoreCase.entity === 'Thumbnail' || restoreCase.entity === 'VideoFile') {
                        await source
                            .getRepository(entities.Recorded)
                            .insert([recorded(previousId), recorded(restoredId)]);
                    }
                    await source.getRepository(entities[restoreCase.entity]).insert(restoreCase.make(previousId));

                    const retryBefore = retry.calls;
                    const faultHarness = installRestoreFault(source, fault);
                    const logBefore = logMessages.length;
                    const repository = db[restoreCase.repo];

                    let rejection: unknown;
                    try {
                        await repository.restore([restoreCase.make(restoredId)]);
                    } catch (error) {
                        rejection = error;
                    }
                    const lifecycle = {
                        release: faultHarness.runner.release.mock.calls.length,
                        rollback: faultHarness.runner.rollbackTransaction.mock.calls.length,
                        start: faultHarness.runner.startTransaction.mock.calls.length,
                    };
                    const diagnostics = logMessages.slice(logBefore);
                    const activeAfterRestore = faultHarness.runner.isTransactionActive;
                    vi.restoreAllMocks();
                    await faultHarness.recover();
                    const subsequent = source.createQueryRunner();
                    try {
                        expect(subsequent.isTransactionActive).toBe(false);
                        await subsequent.startTransaction();
                        expect(subsequent.isTransactionActive).toBe(true);
                        await subsequent.rollbackTransaction();
                        expect(subsequent.isTransactionActive).toBe(false);
                    } finally {
                        if (subsequent.isTransactionActive) await subsequent.rollbackTransaction();
                        await subsequent.release();
                    }

                    expect(rejection, `${restoreCase.repo}/${fault}`).toBeInstanceOf(Error);
                    expect((rejection as Error).message).toBe('restore error');
                    expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
                    expect(lifecycle.start).toBe(1);
                    expect(lifecycle.release).toBe(1);
                    expect(lifecycle.rollback).toBe(fault === 'release' ? 0 : 1);
                    expect(faultHarness.activeAtFault).toBe(fault !== 'release');
                    expect(faultHarness.releasedAtFault).toBe(fault === 'release' ? false : undefined);
                    expect(activeAfterRestore).toBe(fault === 'rollback');
                    expect(retry.calls).toBe(retryBefore);

                    const rows = await source
                        .getRepository(entities[restoreCase.entity])
                        .find({ order: { id: 'ASC' } });
                    expect(rows.map(row => Number(row.id))).toEqual(fault === 'release' ? [restoredId] : [previousId]);

                    if (fault === 'release') {
                        expect(diagnostics).toEqual([faultHarness.cleanup]);
                    } else if (fault === 'rollback') {
                        expect(diagnostics).toEqual([faultHarness.primary, faultHarness.cleanup]);
                    } else {
                        expect(diagnostics).toEqual([faultHarness.primary]);
                    }
                });
            }
        }
    }, 120_000);

    it('[PERSIST-4.9-FAULT-HARNESS-RECOVERY] reclaims an active unreleased runner after a mutation fault', async () => {
        await withDialects(async ({ source }) => {
            const faultHarness = installRestoreFault(source, 'mutation');
            const runner = source.createQueryRunner();
            await runner.startTransaction();

            await faultHarness.recover();
            const stateAfterRecovery = {
                active: runner.isTransactionActive,
            };
            const releaseCallsAfterRecovery = faultHarness.runner.release.mock.calls.length;
            if (!runner.isReleased && runner.isTransactionActive) await runner.rollbackTransaction();
            if (!runner.isReleased) await runner.release();

            expect(stateAfterRecovery).toEqual({ active: false });
            expect(releaseCallsAfterRecovery).toBe(1);
        });
    });

    it('[PERSIST-4.8-4.9-RESERVE-UPDATE-MANY-LIFECYCLE] keeps ReserveUpdateManyError while active and release failure leaves committed rows', async () => {
        for (const fault of ['start', 'mutation', 'commit', 'rollback', 'release'] as const) {
            await withDialects(async ({ db, entities, logMessages, retry, source }) => {
                const previousId = 811;
                const updatedId = 812;
                await source
                    .getRepository(entities.Reserve)
                    .insert(makeReserve({ id: previousId, programId: previousId }));

                const retryBefore = retry.calls;
                const faultHarness = installRestoreFault(source, fault);
                const logBefore = logMessages.length;

                let rejection: unknown;
                try {
                    await db.ReserveDB.updateMany({
                        delete: [makeReserve({ id: previousId })],
                        insert: [makeReserve({ id: updatedId, programId: updatedId })],
                    });
                } catch (error) {
                    rejection = error;
                }
                const lifecycle = {
                    release: faultHarness.runner.release.mock.calls.length,
                    rollback: faultHarness.runner.rollbackTransaction.mock.calls.length,
                    start: faultHarness.runner.startTransaction.mock.calls.length,
                };
                const diagnostics = logMessages.slice(logBefore);
                const activeAfterUpdate = faultHarness.runner.isTransactionActive;
                vi.restoreAllMocks();
                await faultHarness.recover();
                const subsequent = source.createQueryRunner();
                try {
                    expect(subsequent.isTransactionActive).toBe(false);
                    await subsequent.startTransaction();
                    expect(subsequent.isTransactionActive).toBe(true);
                    await subsequent.rollbackTransaction();
                    expect(subsequent.isTransactionActive).toBe(false);
                } finally {
                    if (subsequent.isTransactionActive) await subsequent.rollbackTransaction();
                    await subsequent.release();
                }

                expect(rejection, `ReserveDB/${fault}`).toBeInstanceOf(Error);
                expect((rejection as Error).message).toBe('ReserveUpdateManyError');
                expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
                expect(lifecycle.start).toBe(1);
                expect(lifecycle.release).toBe(1);
                expect(lifecycle.rollback).toBe(fault === 'release' ? 0 : 1);
                expect(faultHarness.activeAtFault).toBe(fault !== 'release');
                expect(faultHarness.releasedAtFault).toBe(fault === 'release' ? false : undefined);
                expect(activeAfterUpdate).toBe(fault === 'rollback');
                expect(retry.calls).toBe(retryBefore);

                const rows = await source.getRepository(entities.Reserve).find({ order: { id: 'ASC' } });
                expect(rows.map(row => Number(row.id))).toEqual(fault === 'release' ? [updatedId] : [previousId]);

                if (fault === 'release') {
                    expect(diagnostics).toEqual([faultHarness.cleanup]);
                } else if (fault === 'rollback') {
                    expect(diagnostics).toEqual([faultHarness.primary, faultHarness.cleanup]);
                } else {
                    expect(diagnostics).toEqual([faultHarness.primary]);
                }
            });
        }
    }, 120_000);

    it('[PERSIST-4.8-4.9-CHANNEL-INSERT-LIFECYCLE] keeps the insert error wrapper while active and release failure leaves replacement rows', async () => {
        await withDialects(async ({ db, entities, source }) => {
            const retainedId = 829;
            const insertedId = 830;
            await db.ChannelDB.insert([tunerChannel(retainedId)]);
            await db.ChannelDB.insert([tunerChannel(insertedId)], false);

            const rows = await source.getRepository(entities.Channel).find({ order: { id: 'ASC' } });
            expect(rows.map(row => Number(row.id))).toEqual([retainedId, insertedId]);
        });

        for (const fault of ['start', 'mutation', 'commit', 'rollback', 'release'] as const) {
            await withDialects(async ({ db, entities, logMessages, retry, source }) => {
                const previousId = 831;
                const replacementId = 832;
                await db.ChannelDB.insert([tunerChannel(previousId)]);

                const retryBefore = retry.calls;
                const faultHarness = installRestoreFault(source, fault);
                const logBefore = logMessages.length;

                let rejection: unknown;
                try {
                    await db.ChannelDB.insert([tunerChannel(replacementId)]);
                } catch (error) {
                    rejection = error;
                }
                const lifecycle = {
                    release: faultHarness.runner.release.mock.calls.length,
                    rollback: faultHarness.runner.rollbackTransaction.mock.calls.length,
                    start: faultHarness.runner.startTransaction.mock.calls.length,
                };
                const diagnostics = logMessages.slice(logBefore);
                const activeAfterInsert = faultHarness.runner.isTransactionActive;
                vi.restoreAllMocks();
                await faultHarness.recover();
                const subsequent = source.createQueryRunner();
                try {
                    expect(subsequent.isTransactionActive).toBe(false);
                    await subsequent.startTransaction();
                    expect(subsequent.isTransactionActive).toBe(true);
                    await subsequent.rollbackTransaction();
                    expect(subsequent.isTransactionActive).toBe(false);
                } finally {
                    if (subsequent.isTransactionActive) await subsequent.rollbackTransaction();
                    await subsequent.release();
                }

                expect(rejection, `ChannelDB/${fault}`).toBeInstanceOf(Error);
                expect((rejection as Error).message).toBe('insert error');
                expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
                expect(lifecycle.start).toBe(1);
                expect(lifecycle.release).toBe(1);
                expect(lifecycle.rollback).toBe(fault === 'release' ? 0 : 1);
                expect(faultHarness.activeAtFault).toBe(fault !== 'release');
                expect(faultHarness.releasedAtFault).toBe(fault === 'release' ? false : undefined);
                expect(activeAfterInsert).toBe(fault === 'rollback');
                expect(retry.calls).toBe(retryBefore);

                const rows = await source.getRepository(entities.Channel).find({ order: { id: 'ASC' } });
                expect(rows.map(row => Number(row.id))).toEqual(fault === 'release' ? [replacementId] : [previousId]);

                if (fault === 'release') {
                    expect(diagnostics).toEqual([faultHarness.cleanup]);
                } else if (fault === 'rollback') {
                    expect(diagnostics).toEqual([faultHarness.primary, faultHarness.cleanup]);
                } else {
                    expect(diagnostics).toEqual([faultHarness.primary]);
                }
            });
        }
    }, 120_000);

    it('[PERSIST-4.9-RESERVE-UPDATE-MANY-MUTATION-RELEASE] preserves the primary failure while release cleanup fails', async () => {
        await withDialects(async ({ db, entities, logMessages, retry, source }) => {
            const previousId = 821;
            const updatedId = 822;
            const primary = new Error('synthetic-reserve-mutation-primary');
            const cleanup = new Error('synthetic-reserve-release-cleanup');
            const originalFactory = source.createQueryRunner.bind(source);
            let runner: any;
            let recover = async () => undefined;
            await source.getRepository(entities.Reserve).insert(makeReserve({ id: previousId, programId: previousId }));

            const retryBefore = retry.calls;
            vi.spyOn(source, 'createQueryRunner').mockImplementation((mode?: any) => {
                runner = originalFactory(mode);
                const originalRelease = runner.release.bind(runner);
                vi.spyOn(runner, 'startTransaction');
                vi.spyOn(runner, 'rollbackTransaction');
                vi.spyOn(runner, 'release').mockImplementation(async () => {
                    throw cleanup;
                });
                vi.spyOn(runner.manager, 'delete').mockImplementation(async () => {
                    throw primary;
                });
                recover = async () => {
                    if (!runner.isReleased && runner.isTransactionActive) await runner.rollbackTransaction();
                    if (!runner.isReleased) await originalRelease();
                };
                return runner;
            });
            const logBefore = logMessages.length;

            let rejection: unknown;
            try {
                await db.ReserveDB.updateMany({
                    delete: [makeReserve({ id: previousId })],
                    insert: [makeReserve({ id: updatedId, programId: updatedId })],
                });
            } catch (error) {
                rejection = error;
            }

            const lifecycle = {
                release: runner.release.mock.calls.length,
                rollback: runner.rollbackTransaction.mock.calls.length,
                start: runner.startTransaction.mock.calls.length,
            };
            const diagnostics = logMessages.slice(logBefore);
            vi.restoreAllMocks();
            await recover();
            const rows = await source.getRepository(entities.Reserve).find({ order: { id: 'ASC' } });
            const subsequent = source.createQueryRunner();
            try {
                expect(subsequent.isTransactionActive).toBe(false);
                await subsequent.startTransaction();
                expect(subsequent.isTransactionActive).toBe(true);
                await subsequent.rollbackTransaction();
                expect(subsequent.isTransactionActive).toBe(false);
            } finally {
                if (subsequent.isTransactionActive) await subsequent.rollbackTransaction();
                await subsequent.release();
            }

            expect(rejection).toBeInstanceOf(Error);
            expect((rejection as Error).message).toBe('ReserveUpdateManyError');
            expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
            expect(lifecycle).toEqual({ release: 1, rollback: 1, start: 1 });
            expect(rows.map(row => Number(row.id))).toEqual([previousId]);
            expect(diagnostics).toEqual([primary, cleanup]);
            expect(retry.calls).toBe(retryBefore);
        });
    }, 60_000);

    it('[PERSIST-3.2-STAGES] retains a committed earlier restore kind when a later kind rolls back', async () => {
        await withDialects(async ({ db, entities, source }) => {
            await db.RuleDB.restore([makeRule({ id: 41 })]);
            await db.ReserveDB.restore([makeReserve({ id: 51, programId: 51 })]);
            await expect(
                db.ReserveDB.restore([makeReserve({ id: 52, programId: 52 }), makeReserve({ id: 52, programId: 53 })]),
            ).rejects.toThrow('restore error');
            expect((await source.getRepository(entities.Rule).find()).map(row => row.id)).toEqual([41]);
            expect((await source.getRepository(entities.Reserve).find()).map(row => row.id)).toEqual([51]);
        });
    });

    it('[PERSIST-3.3] records individual program failures, continues later work, commits successes, and fulfills', async () => {
        await withDialects(async ({ db, entities, logMessages, retry, source }) => {
            await source
                .getRepository(entities.Program)
                .insert([
                    makeProgram({ id: 1, name: 'delete-fails' }),
                    makeProgram({ id: 2, name: 'delete-succeeds' }),
                ]);
            const originalFactory = source.createQueryRunner.bind(source);
            vi.spyOn(source, 'createQueryRunner').mockImplementation(mode => {
                const runner = originalFactory(mode);
                const originalDelete = runner.manager.delete.bind(runner.manager);
                const originalInsert = runner.manager.insert.bind(runner.manager);
                const originalUpdate = runner.manager.update.bind(runner.manager);
                vi.spyOn(runner.manager, 'delete').mockImplementation(async (target, criteria) => {
                    if (criteria === 1) throw new Error('synthetic-delete-failure');
                    return originalDelete(target, criteria);
                });
                vi.spyOn(runner.manager, 'insert').mockImplementation(async (target, value: any) => {
                    if (Number(value.id) === 3) throw new Error('synthetic-insert-failure');
                    return originalInsert(target, value);
                });
                vi.spyOn(runner.manager, 'update').mockImplementation(async (target, criteria, value) => {
                    if (Number((value as { id?: number }).id) === 3) throw new Error('synthetic-update-failure');
                    return originalUpdate(target, criteria, value);
                });
                return runner;
            });
            const retryBefore = retry.calls;
            await expect(
                db.ProgramDB.update(channelIndex, {
                    delete: [1, 2],
                    insert: [tunerProgram(3), tunerProgram(4)],
                    update: [],
                }),
            ).resolves.toBeUndefined();
            const rows = await source.getRepository(entities.Program).find({ order: { id: 'ASC' } });
            expect(rows.map(row => Number(row.id))).toEqual([1, 4]);
            expect(logMessages).toContain('program delete error: 1');
            expect(logMessages).toContain('program update error');
            expect(retry.calls).toBe(retryBefore);
        });
    });

    it('[PERSIST-4.8-4.9-PROGRAM-UPDATE-LIFECYCLE] keeps incremental failures partial across primary and cleanup fault combinations', async () => {
        for (const { cleanupFault, primaryFault } of [
            { primaryFault: 'start' },
            { primaryFault: 'mutation' },
            { primaryFault: 'commit' },
            { cleanupFault: 'release' },
            { cleanupFault: 'release', primaryFault: 'start' },
            { cleanupFault: 'release', primaryFault: 'mutation' },
            { cleanupFault: 'release', primaryFault: 'commit' },
            { cleanupFault: 'rollback', primaryFault: 'commit' },
        ] as const) {
            await withDialects(async ({ db, dialect, entities, logMessages, retry, source }) => {
                const previousId = 861;
                const replacementId = 862;
                await source
                    .getRepository(entities.Program)
                    .insert(makeProgram({ id: previousId, channelId: 11, name: 'program-update-previous' }));

                const retryBefore = retry.calls;
                const faultHarness = installProgramUpdateFault(source, { cleanupFault, primaryFault });

                let rejection: unknown;
                try {
                    await db.ProgramDB.update(channelIndex, {
                        delete: [previousId],
                        insert: [tunerProgram(replacementId)],
                        update: [],
                    });
                } catch (error) {
                    rejection = error;
                }
                const lifecycle = {
                    release: faultHarness.runner.release.mock.calls.length,
                    rollback: faultHarness.runner.rollbackTransaction.mock.calls.length,
                    start: faultHarness.runner.startTransaction.mock.calls.length,
                };
                const activeAfterUpdate = faultHarness.runner.isTransactionActive;
                vi.restoreAllMocks();
                await faultHarness.recover();

                if (primaryFault === 'mutation' && cleanupFault === undefined) {
                    expect(rejection).toBeUndefined();
                } else {
                    expect(
                        rejection,
                        `ProgramDB.update/${primaryFault ?? 'success'}/${cleanupFault ?? 'none'}`,
                    ).toBeInstanceOf(Error);
                    expect((rejection as Error).message).toBe('UpdateError');
                    expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
                }
                expect(lifecycle.start).toBe(1);
                expect(lifecycle.release).toBe(1);
                expect(lifecycle.rollback).toBe(primaryFault === 'commit' ? 1 : 0);
                expect(faultHarness.activeAtPrimaryFault).toBe(
                    primaryFault === undefined ? undefined : primaryFault !== 'start',
                );
                expect(faultHarness.activeAtCleanupFault).toBe(
                    cleanupFault === undefined ? undefined : cleanupFault === 'rollback',
                );
                expect(faultHarness.releasedAtCleanupFault).toBe(cleanupFault === 'release' ? false : undefined);
                expect(activeAfterUpdate).toBe(cleanupFault === 'rollback');
                expect(retry.calls).toBe(retryBefore);

                const rows = await source.getRepository(entities.Program).find({ order: { id: 'ASC' } });
                const expectedRows =
                    primaryFault === undefined ||
                    primaryFault === 'mutation' ||
                    (primaryFault === 'commit' && cleanupFault === 'rollback' && dialect === 'mysql')
                        ? primaryFault === 'mutation'
                            ? [previousId, replacementId]
                            : [replacementId]
                        : [previousId];
                expect(
                    rows.map(row => Number(row.id)),
                    `ProgramDB.update/${primaryFault ?? 'success'}/${cleanupFault ?? 'none'}/${dialect} rows`,
                ).toEqual(expectedRows);
                // 個別の削除失敗の記録に続いて、transaction の失敗と後始末の失敗が system log に残る。
                expect(logMessages).toEqual([
                    ...(primaryFault === 'mutation' ? [`program delete error: ${previousId}`, faultHarness.primary] : []),
                    ...(primaryFault === 'start' || primaryFault === 'commit' ? [faultHarness.primary] : []),
                    ...(cleanupFault === undefined ? [] : [faultHarness.cleanup]),
                ]);
            });
        }
    }, 120_000);

    it('[PERSIST-3.3-NONUNIFORM] keeps a representative channel batch non-atomic and outside common retry', async () => {
        await withDialects(async ({ db, entities, logMessages, retry, source }) => {
            const originalFactory = source.createQueryRunner.bind(source);
            vi.spyOn(source, 'createQueryRunner').mockImplementation(mode => {
                const runner = originalFactory(mode);
                const originalInsert = runner.manager.insert.bind(runner.manager);
                vi.spyOn(runner.manager, 'insert').mockImplementation(async (target, value: any) => {
                    if (Number(value.id) === 1) throw new Error('synthetic-channel-insert-failure');
                    return originalInsert(target, value);
                });
                vi.spyOn(runner.manager, 'update').mockImplementation(async () => {
                    throw new Error('synthetic-channel-update-failure');
                });
                return runner;
            });
            const retryBefore = retry.calls;
            await expect(
                db.ChannelDB.insert([
                    {
                        id: 1,
                        serviceId: 1,
                        networkId: 1,
                        name: 'synthetic-failed-channel',
                        channel: { type: 'GR', channel: 'synthetic-1' },
                    },
                    {
                        id: 2,
                        serviceId: 2,
                        networkId: 1,
                        name: 'synthetic-success-channel',
                        channel: { type: 'GR', channel: 'synthetic-2' },
                    },
                ]),
            ).resolves.toBeUndefined();
            const rows = await source.getRepository(entities.Channel).find({ order: { id: 'ASC' } });
            expect(rows.map(row => Number(row.id))).toEqual([2]);
            expect(logMessages).toContain('channel update error');
            expect(retry.calls).toBe(retryBefore);
        });
    });
});

// The container is removed here, in a test of its own with the budget its provisioning has, rather than in
// `afterAll`: the Docker daemon answers `docker rm --force` late while it is busy (an image export holds
// it for tens of seconds), and a hook only has Vitest's default 10 s. The `afterAll` above confirms the
// container is gone and removes it itself only when this test did not run (a filtered or aborted file).
it(
    'releases the isolated MySQL fixture container after every case of the file',
    async () => {
        await mysqlRuntime.cleanup();
    },
    MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS,
);
