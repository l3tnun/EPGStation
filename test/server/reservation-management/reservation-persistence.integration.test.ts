import { describe, expect, it, vi } from 'vitest';
import { createPersistence, makeModel, makeReserve, Reserve } from './_harness';

// Each case releases the persistence it created in a `finally` of its own body, not in an `afterEach`: a
// MySQL case's release removes its fixture container, which the Docker daemon answers late while it is
// busy (an image export holds `docker rm --force` for tens of seconds), so it is awaited with the case's
// timeout rather than with Vitest's default hook timeout of 10 s.

const createRetryAfterOneFailure = () => {
    let runCount = 0;
    let attemptCount = 0;

    return {
        retry: {
            async run<T>(job: () => Promise<T>): Promise<T> {
                runCount += 1;
                attemptCount += 1;
                try {
                    return await job();
                } catch {
                    attemptCount += 1;
                    return job();
                }
            },
        },
        get runCount(): number {
            return runCount;
        },
        get attemptCount(): number {
            return attemptCount;
        },
    };
};

const failQueryBuilderMutationOnce = (source: any, operation: 'insert' | 'update') => {
    const originalCreateQueryBuilder = source.createQueryBuilder.bind(source) as (...args: any[]) => any;
    const mutation = { execute: undefined as ReturnType<typeof vi.spyOn> | undefined };
    const queryBuilder = vi.spyOn(source, 'createQueryBuilder').mockImplementation((...queryArgs: any[]) => {
        const builder = originalCreateQueryBuilder(...queryArgs) as any;
        if (queryArgs.length > 0) return builder;
        const originalMutation = builder[operation].bind(builder);
        vi.spyOn(builder, operation).mockImplementation((...args: any[]) => {
            const result = originalMutation(...args);
            mutation.execute = vi
                .spyOn(result, 'execute')
                .mockRejectedValueOnce(new Error(`synthetic retryable ${operation} failure`));
            return result;
        });
        return builder;
    });

    return { mutation, queryBuilder };
};

interface TransactionSession {
    readonly commitCalls: number;
    readonly releaseCalls: number;
    readonly rollbackCalls: number;
    readonly runner: any;
    readonly startCalls: number;
}

interface RunnerCallCounters {
    commit: { value: number };
    release: { value: number };
    rollback: { value: number };
    start: { value: number };
}

const makeRunnerCallCounters = (): RunnerCallCounters => ({
    commit: { value: 0 },
    release: { value: 0 },
    rollback: { value: 0 },
    start: { value: 0 },
});

// sqlite の QueryRunner はドライバーに 1 個だけキャッシュされるため、同じ `source` に対して
// `createQueryRunner()` を複数回呼んでも（同じ test 内で `observeTransactionSessions` を複数回呼び直しても）
// 同じ instance が返る（`AbstractSqliteQueryRunner.release` のコメントどおり複数 connection/query runner を
// 持たない仕様）。Vitest 5 の `vi.spyOn` は対象が既に mock だとその mock をそのまま返し呼び出し履歴も
// 引き継ぐため、この instance を知らない別の `observeTransactionSessions` 呼び出しが「まだ spy されていない」
// と誤認して再度 `runner.method.bind(runner)` を true original として捕まえると、実際には直前の mock を
// 捕まえてしまい、`mockImplementation` の上書き後に自己再帰する（Maximum call stack size exceeded）。
// そのため instrumentation 自体は runner instance ごとに module scope で一度だけ行い、以後の session は
// 呼び出し回数を数える先の counters オブジェクトを差し替えるだけにする。
const instrumentationByRunner = new WeakMap<object, { current: RunnerCallCounters }>();

const ensureRunnerInstrumented = (runner: any): { current: RunnerCallCounters } => {
    const existing = instrumentationByRunner.get(runner);
    if (existing !== undefined) return existing;

    const trueOriginalCommit = runner.commitTransaction.bind(runner);
    const trueOriginalRelease = runner.release.bind(runner);
    const trueOriginalRollback = runner.rollbackTransaction.bind(runner);
    const trueOriginalStart = runner.startTransaction.bind(runner);
    const entry = { current: makeRunnerCallCounters() };
    instrumentationByRunner.set(runner, entry);

    vi.spyOn(runner, 'commitTransaction').mockImplementation(async (...arguments_: any[]) => {
        entry.current.commit.value += 1;
        return trueOriginalCommit(...arguments_);
    });
    vi.spyOn(runner, 'release').mockImplementation(async (...arguments_: any[]) => {
        entry.current.release.value += 1;
        return trueOriginalRelease(...arguments_);
    });
    vi.spyOn(runner, 'rollbackTransaction').mockImplementation(async (...arguments_: any[]) => {
        entry.current.rollback.value += 1;
        return trueOriginalRollback(...arguments_);
    });
    vi.spyOn(runner, 'startTransaction').mockImplementation(async (...arguments_: any[]) => {
        entry.current.start.value += 1;
        return trueOriginalStart(...arguments_);
    });
    return entry;
};

const observeTransactionSessions = (source: any, onSession?: (runner: any) => void) => {
    let createQueryRunnerCallCount = 0;
    const sessions: TransactionSession[] = [];
    const originalCreateQueryRunner = source.createQueryRunner.bind(source) as () => any;

    const createQueryRunner = vi.spyOn(source, 'createQueryRunner').mockImplementation(() => {
        createQueryRunnerCallCount += 1;
        const runner = originalCreateQueryRunner();

        const entry = ensureRunnerInstrumented(runner);
        const counters = makeRunnerCallCounters();
        entry.current = counters;
        sessions.push({
            get commitCalls() {
                return counters.commit.value;
            },
            get releaseCalls() {
                return counters.release.value;
            },
            get rollbackCalls() {
                return counters.rollback.value;
            },
            runner,
            get startCalls() {
                return counters.start.value;
            },
        });
        onSession?.(runner);
        return runner;
    });

    return {
        createQueryRunner,
        get createQueryRunnerCallCount() {
            return createQueryRunnerCallCount;
        },
        sessions,
    };
};

describe('reservation persistence characterization', () => {
    it.each(['sqlite', 'mysql'] as const)(
        '[RM-1.1/RM-1.2/RM-1.3] round-trips kinds, flags, and recording options on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const row = makeReserve({
                    id: undefined,
                    ruleId: 7,
                    isConflict: true,
                    isSkip: true,
                    tags: '["synthetic"]',
                    directory: 'synthetic-dir',
                    encodeMode1: 'synthetic-mode',
                });
                const id = await persistence.db.insertOnce(row);
                await expect(persistence.db.findId(id)).resolves.toMatchObject({
                    ruleId: 7,
                    isConflict: true,
                    isSkip: true,
                    tags: '["synthetic"]',
                    directory: 'synthetic-dir',
                    encodeMode1: 'synthetic-mode',
                });
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-T8.1][RM-1.1/RM-7.1/RM-7.2/RM-7.3/RM-7.6/RM-8.4] updates one row and reads ID, program, rule, time, expired, state, and count contracts on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const normal = makeReserve({
                    id: undefined,
                    programId: 911,
                    ruleId: 91,
                    startAt: 10,
                    endAt: 20,
                    name: 'before-update',
                });
                const conflict = makeReserve({
                    id: undefined,
                    programId: 912,
                    ruleId: 91,
                    startAt: 20,
                    endAt: 30,
                    isConflict: true,
                });
                const skipped = makeReserve({
                    id: undefined,
                    programId: 913,
                    ruleId: 91,
                    startAt: 30,
                    endAt: 40,
                    isSkip: true,
                });
                const overlapped = makeReserve({
                    id: undefined,
                    programId: 914,
                    ruleId: 91,
                    startAt: 40,
                    endAt: 50,
                    isOverlap: true,
                });
                const normalId = await persistence.db.insertOnce(normal);
                await persistence.db.insertOnce(conflict);
                await persistence.db.insertOnce(skipped);
                await persistence.db.insertOnce(overlapped);

                const updated = await persistence.db.findId(normalId);
                updated!.name = 'after-update';
                await persistence.db.updateOnce(updated!);

                await expect(persistence.db.findId(normalId)).resolves.toMatchObject({ name: 'after-update' });
                await expect(persistence.db.findProgramId(912)).resolves.toEqual([
                    expect.objectContaining({ programId: 912 }),
                ]);
                await expect(
                    persistence.db.findRuleId({
                        ruleId: 91,
                        hasConflict: true,
                        hasEventRelay: true,
                        hasOverlap: true,
                        hasSkip: true,
                    }),
                ).resolves.toHaveLength(4);
                await expect(
                    persistence.db.findTimeRanges({
                        times: [{ startAt: 19, endAt: 21 }],
                        hasConflict: true,
                        hasOverlap: true,
                        hasSkip: true,
                    }),
                ).resolves.toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ programId: 911 }),
                        expect.objectContaining({ programId: 912 }),
                    ]),
                );
                await expect(persistence.db.findOldTime(21)).resolves.toEqual([
                    expect.objectContaining({ id: normalId }),
                ]);
                for (const [type, programId] of [
                    ['normal', 911],
                    ['conflict', 912],
                    ['skip', 913],
                    ['overlap', 914],
                ] as const) {
                    await expect(persistence.db.findAll({ type, ruleId: 91, offset: 0, limit: 10 })).resolves.toEqual([
                        [expect.objectContaining({ programId })],
                        1,
                    ]);
                    await expect(persistence.db.countRuleIds([91], type)).resolves.toEqual([
                        { ruleId: 91, ruleIdCnt: 1 },
                    ]);
                }
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-T8.1][RM-3.3/RM-8.5] commits one reservation diff in delete, insert, update order on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const deletedId = await persistence.db.insertOnce(makeReserve({ id: undefined, programId: 921 }));
                const updatedId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, name: 'before-diff-update', programId: 922 }),
                );
                const inserted = makeReserve({ id: undefined, programId: 923 });
                const updated = await persistence.db.findId(updatedId);
                updated!.name = 'after-diff-update';
                const createQueryRunner = persistence.source.createQueryRunner.bind(persistence.source);
                let deleteReserve: ReturnType<typeof vi.spyOn> | undefined;
                let insertReserve: ReturnType<typeof vi.spyOn> | undefined;
                let updateReserve: ReturnType<typeof vi.spyOn> | undefined;
                const queryRunner = vi.spyOn(persistence.source, 'createQueryRunner').mockImplementation(() => {
                    const runner = createQueryRunner();
                    deleteReserve = vi.spyOn(runner.manager, 'delete');
                    insertReserve = vi.spyOn(runner.manager, 'insert');
                    updateReserve = vi.spyOn(runner.manager, 'update');
                    return runner;
                });

                try {
                    await persistence.db.updateMany({
                        delete: [makeReserve({ id: deletedId })],
                        insert: [inserted],
                        update: [updated!],
                    });
                } finally {
                    queryRunner.mockRestore();
                }

                expect(deleteReserve).toHaveBeenCalledWith(Reserve, [deletedId]);
                expect(insertReserve).toHaveBeenCalledWith(Reserve, inserted);
                expect(updateReserve).toHaveBeenCalledWith(Reserve, updatedId, updated);
                expect(deleteReserve!.mock.invocationCallOrder[0]).toBeLessThan(
                    insertReserve!.mock.invocationCallOrder[0],
                );
                expect(insertReserve!.mock.invocationCallOrder[0]).toBeLessThan(
                    updateReserve!.mock.invocationCallOrder[0],
                );
                await expect(persistence.db.findId(deletedId)).resolves.toBeNull();
                await expect(persistence.db.findId(inserted.id)).resolves.toMatchObject({ programId: 923 });
                await expect(persistence.db.findId(updatedId)).resolves.toMatchObject({ name: 'after-diff-update' });
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-T8.1][RM-3.3/RM-8.5] rolls each failed diff stage back without retrying it and retains only a generated insert ID on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const deletedId = await persistence.db.insertOnce(makeReserve({ id: undefined, programId: 931 }));
                const updatedId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, name: 'before-failed-diff-update', programId: 932 }),
                );
                const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
                const failedTransactionRunners: any[] = [];

                try {
                    for (const stage of ['delete', 'insert', 'update'] as const) {
                        const inserted = makeReserve({
                            id: undefined,
                            programId: 940 + ['delete', 'insert', 'update'].indexOf(stage),
                        });
                        const updated = await persistence.db.findId(updatedId);
                        updated!.name = `after-${stage}-failure`;
                        let failedStage: ReturnType<typeof vi.spyOn> | undefined;
                        const transactions = observeTransactionSessions(persistence.source, runner => {
                            failedStage = vi
                                .spyOn(runner.manager, stage)
                                .mockRejectedValueOnce(new Error(`${stage} failure`));
                        });
                        try {
                            await expect(
                                persistence.db.updateMany({
                                    delete: [makeReserve({ id: deletedId })],
                                    insert: [inserted],
                                    update: [updated!],
                                }),
                            ).rejects.toThrow('ReserveUpdateManyError');
                        } finally {
                            transactions.createQueryRunner.mockRestore();
                        }

                        expect(transactions.createQueryRunnerCallCount).toBe(1);
                        expect(transactions.sessions).toHaveLength(1);
                        for (const transaction of transactions.sessions) {
                            expect(transaction.startCalls).toBe(1);
                            expect(transaction.commitCalls).toBe(0);
                            expect(transaction.rollbackCalls).toBe(1);
                            expect(transaction.releaseCalls).toBe(1);
                            expect(transaction.runner.isTransactionActive).toBe(false);
                            failedTransactionRunners.push(transaction.runner);
                        }
                        expect(failedStage).toHaveBeenCalledOnce();
                        await expect(persistence.db.findId(deletedId)).resolves.toMatchObject({ programId: 931 });
                        await expect(persistence.db.findId(updatedId)).resolves.toMatchObject({
                            name: 'before-failed-diff-update',
                        });
                        await expect(persistence.db.findProgramId(inserted.programId)).resolves.toEqual([]);
                        if (stage === 'update') {
                            expect(inserted.id).toEqual(expect.any(Number));
                        } else {
                            expect(inserted.id).toBeUndefined();
                        }
                    }
                    expect(new Set(failedTransactionRunners).size).toBe(dialect === 'sqlite' ? 1 : 3);
                } finally {
                    error.mockRestore();
                }
            } finally {
                await persistence.cleanup();
            }
        },
    );

    describe('sqlite-and-mysql-save-query-filter-count-and-diff-rollback', () => {
        it.each(['sqlite', 'mysql'] as const)(
            '[RM-T9.4] commits a no-target diff, preserves its next diff, and releases both transaction sessions on %s',
            { timeout: 60_000 },
            async dialect => {
                const persistence = await createPersistence(dialect);
                try {
                    const transactions = observeTransactionSessions(persistence.source);
                    const inserted = makeReserve({ id: undefined, programId: 9_401, ruleId: 94 });

                    try {
                        await expect(persistence.db.updateMany({})).resolves.toBeUndefined();
                        await expect(persistence.db.updateMany({ insert: [inserted] })).resolves.toBeUndefined();
                    } finally {
                        transactions.createQueryRunner.mockRestore();
                    }

                    expect(transactions.sessions).toHaveLength(2);
                    expect(transactions.createQueryRunnerCallCount).toBe(2);
                    expect(new Set(transactions.sessions.map(session => session.runner)).size).toBe(
                        dialect === 'sqlite' ? 1 : 2,
                    );
                    for (const transaction of transactions.sessions) {
                        expect(transaction.startCalls).toBe(1);
                        expect(transaction.commitCalls).toBe(1);
                        expect(transaction.rollbackCalls).toBe(0);
                        expect(transaction.releaseCalls).toBe(1);
                        expect(transaction.runner.isTransactionActive).toBe(false);
                    }
                    await expect(persistence.db.findAll({ ruleId: 94, offset: 0, limit: 10 })).resolves.toEqual([
                        [expect.objectContaining({ id: inserted.id, programId: 9_401 })],
                        1,
                    ]);
                    await expect(persistence.db.countRuleIds([94], 'all')).resolves.toEqual([
                        { ruleId: 94, ruleIdCnt: 1 },
                    ]);
                } finally {
                    await persistence.cleanup();
                }
            },
        );
    });

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-7.1/RM-7.2/RM-7.3/RM-7.6] applies exact state and rule filters with matching totals on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                for (const row of [
                    makeReserve({ id: undefined, ruleId: 3, startAt: 30 }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 20, isConflict: true }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 10, isConflict: true, isSkip: true }),
                    makeReserve({ id: undefined, ruleId: 4, startAt: 40, isConflict: true }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 50, isSkip: true }),
                    makeReserve({ id: undefined, ruleId: 3, startAt: 60, isOverlap: true }),
                ])
                    await persistence.db.insertOnce(row);
                const [rows, total] = await persistence.db.findAll({
                    type: 'conflict',
                    ruleId: 3,
                    offset: 0,
                    limit: 10,
                });
                expect(rows.map((row: any) => row.startAt)).toEqual([20]);
                expect(total).toBe(1);
                expect(await persistence.db.countRuleIds([3, 4], 'conflict')).toEqual([
                    { ruleId: 3, ruleIdCnt: 1 },
                    { ruleId: 4, ruleIdCnt: 1 },
                ]);

                const count = async (state: 'all' | 'normal' | 'conflict' | 'skip' | 'overlap') =>
                    [...(await persistence.db.countByRuleIds([3, 99, 4], state))].sort(
                        (left: any, right: any) => left.ruleId - right.ruleId,
                    );
                await expect(persistence.db.countByRuleIds([], 'all')).resolves.toEqual([]);
                await expect(count('all')).resolves.toEqual([
                    { ruleId: 3, count: 5 },
                    { ruleId: 4, count: 1 },
                ]);
                await expect(count('normal')).resolves.toEqual([{ ruleId: 3, count: 1 }]);
                await expect(count('conflict')).resolves.toEqual([
                    { ruleId: 3, count: 1 },
                    { ruleId: 4, count: 1 },
                ]);
                await expect(count('skip')).resolves.toEqual([{ ruleId: 3, count: 1 }]);
                await expect(count('overlap')).resolves.toEqual([{ ruleId: 3, count: 1 }]);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-2.5/RM-4.5] adds manual and relay reservations past unrelated stored conflicts and rejects new conflicts on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const now = Date.now();
                const rows = {
                    bsNormal: makeReserve({
                        id: undefined,
                        ruleId: 1,
                        programId: 200,
                        channelId: 20,
                        channel: 'synthetic-bs-1',
                        channelType: 'BS',
                        startAt: now + 10_000,
                        endAt: now + 20_000,
                    }),
                    bsConflict: makeReserve({
                        id: undefined,
                        ruleId: 2,
                        programId: 201,
                        channelId: 21,
                        channel: 'synthetic-bs-2',
                        channelType: 'BS',
                        startAt: now + 10_000,
                        endAt: now + 20_000,
                        isConflict: true,
                    }),
                    grNormal: makeReserve({
                        id: undefined,
                        ruleId: 3,
                        programId: 202,
                        channelId: 22,
                        channel: 'synthetic-gr-1',
                        startAt: now + 30_000,
                        endAt: now + 40_000,
                    }),
                    grConflict: makeReserve({
                        id: undefined,
                        ruleId: 4,
                        programId: 203,
                        channelId: 23,
                        channel: 'synthetic-gr-2',
                        startAt: now + 30_000,
                        endAt: now + 40_000,
                        isConflict: true,
                    }),
                };
                const ids: Record<string, number> = {};
                for (const [key, row] of Object.entries(rows)) {
                    ids[key] = await persistence.db.insertOnce(row);
                }
                const programs: Record<number, Record<string, any>> = {
                    210: makeReserve({
                        id: 210,
                        channelId: 24,
                        channel: 'synthetic-gr-new',
                        startAt: now + 10_000,
                        endAt: now + 20_000,
                    }),
                    211: makeReserve({
                        id: 211,
                        channelId: 25,
                        channel: 'synthetic-gr-relay',
                        startAt: now + 40_000,
                        endAt: now + 50_000,
                    }),
                    212: makeReserve({
                        id: 212,
                        channelId: 26,
                        channel: 'synthetic-gr-late',
                        startAt: now + 30_000,
                        endAt: now + 40_000,
                    }),
                    213: makeReserve({
                        id: 213,
                        channelId: 27,
                        channel: 'synthetic-gr-relay-2',
                        startAt: now + 30_000,
                        endAt: now + 40_000,
                    }),
                };
                const harness = makeModel({
                    reserveDB: persistence.db,
                    programDB: { findId: vi.fn(async (id: number) => programs[id] ?? null), findRule: vi.fn() },
                });
                harness.model.setTuners([{ types: ['GR'] }, { types: ['BS'] }]);

                // 別の放送波の競合が残る時間帯でも、手動予約を追加できる
                const manualId = await harness.model.add({ programId: 210, allowEndLack: false });
                await expect(persistence.db.findId(manualId)).resolves.toMatchObject({
                    programId: 210,
                    isConflict: false,
                });

                // 開始時刻ちょうどに終わる予約は時間帯の照会に含まれるが、番組リレーの追加を妨げない
                const boundary = await persistence.db.findTimeRanges({
                    times: [{ startAt: now + 40_000, endAt: now + 50_000 }],
                    hasSkip: false,
                    hasConflict: true,
                    hasOverlap: false,
                });
                expect(boundary.map((row: any) => row.id).sort()).toEqual([ids.grNormal, ids.grConflict].sort());
                const relayId = await harness.model.addEventRelay(211, makeReserve({ ruleId: 5 }));
                await expect(persistence.db.findId(relayId)).resolves.toMatchObject({
                    programId: 211,
                    ruleId: 5,
                    isEventRelay: true,
                    isConflict: false,
                });

                // 通常の既存予約を競合にする追加と、新しい予約自体が競合になる追加は拒否する
                await expect(harness.model.add({ programId: 212, allowEndLack: false })).rejects.toThrow(
                    'ReservationManageModelAddReserveConflict',
                );
                await expect(harness.model.addEventRelay(213, makeReserve({ ruleId: 9 }))).rejects.toThrow(
                    'ReservationManageModelAddReserveConflict',
                );
                expect((await persistence.db.findAll({ isHalfWidth: false }))[1]).toBe(6);
                await expect(persistence.db.findId(ids.grNormal)).resolves.toMatchObject({ isConflict: false });
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-2.3/RM-2.5/RM-2.6/RM-6.5] applies approved manual mutation boundaries on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const channel = { id: 10, channel: 'synthetic-new', channelType: 'GR' };
                const harness = makeModel({
                    reserveDB: persistence.db,
                    channelDB: { findId: vi.fn(async () => channel) },
                });
                harness.model.setTuners([{ types: ['GR'] }]);
                const now = Date.now();

                await expect(
                    harness.model.add({
                        allowEndLack: false,
                        timeSpecifiedOption: {
                            channelId: 10,
                            startAt: now + 30_000,
                            endAt: now + 20_000,
                            name: 'synthetic-inverted',
                        },
                    }),
                ).rejects.toThrow('TimeSpecifiedOptionError');
                expect((await persistence.db.findAll({ isHalfWidth: false }))[1]).toBe(0);

                await persistence.db.insertOnce(
                    makeReserve({
                        id: undefined,
                        ruleId: null,
                        programId: null,
                        isTimeSpecified: true,
                        isEventRelay: true,
                        channelId: 11,
                        channel: 'synthetic-existing',
                        startAt: now + 10_000,
                        endAt: now + 20_000,
                        isConflict: true,
                        updateTime: 1,
                    }),
                );
                await expect(
                    harness.model.add({
                        allowEndLack: false,
                        timeSpecifiedOption: {
                            channelId: 10,
                            startAt: now + 10_000,
                            endAt: now + 20_000,
                            name: 'synthetic-conflict',
                        },
                    }),
                ).rejects.toThrow('ReservationManageModelAddReserveConflict');
                expect((await persistence.db.findAll({ isHalfWidth: false }))[1]).toBe(1);

                const timeManualId = await harness.model.add({
                    allowEndLack: false,
                    timeSpecifiedOption: {
                        channelId: 10,
                        startAt: now + 30_000,
                        endAt: now + 40_000,
                        name: 'synthetic-time-manual',
                    },
                });
                await expect(persistence.db.findId(timeManualId)).resolves.toMatchObject({
                    ruleId: null,
                    programId: null,
                    isTimeSpecified: true,
                    isEventRelay: true,
                    name: 'synthetic-time-manual',
                });

                const programManualId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, programId: 80, updateTime: 1 }),
                );
                const beforeEdit = Date.now();
                await harness.model.edit(programManualId, { allowEndLack: true, tags: ['edited'] });
                const afterEdit = Date.now();
                const edited = await persistence.db.findId(programManualId);
                expect(edited).toMatchObject({ allowEndLack: true, tags: '["edited"]' });
                expect(edited!.updateTime).toBeGreaterThanOrEqual(beforeEdit);
                expect(edited!.updateTime).toBeLessThanOrEqual(afterEdit);

                const ruleReserveId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, ruleId: 4, programId: 81, updateTime: 2 }),
                );
                await expect(harness.model.edit(ruleReserveId, { allowEndLack: true })).rejects.toThrow(
                    'ReservationIsNotEditable',
                );
                await expect(persistence.db.findId(ruleReserveId)).resolves.toMatchObject({
                    allowEndLack: false,
                    updateTime: 2,
                });

                const manualRelayId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, programId: 82, isEventRelay: true, updateTime: 3 }),
                );
                await harness.model.edit(manualRelayId, { allowEndLack: true, tags: ['relay-edited'] });
                const editedRelay = await persistence.db.findId(manualRelayId);
                expect(editedRelay).toMatchObject({
                    ruleId: null,
                    programId: 82,
                    isEventRelay: true,
                    allowEndLack: true,
                    tags: '["relay-edited"]',
                });
                expect(editedRelay!.updateTime).toBeGreaterThan(3);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-T8.1][RM-1.1/RM-3.3] retries persistence once without repeating the domain insert or event on %s',
        { timeout: 60_000 },
        async dialect => {
            const retrier = createRetryAfterOneFailure();
            const persistence = await createPersistence(dialect, { retry: retrier.retry });
            try {
                const reserveEvent = { emitUpdated: vi.fn() };
                const harness = makeModel({
                    reserveDB: persistence.db,
                    reserveEvent,
                    channelDB: { findId: vi.fn(async () => ({ id: 10, channel: 'retry-channel', channelType: 'GR' })) },
                });
                harness.model.setTuners([{ types: ['GR'] }]);
                const insertOnce = vi.spyOn(persistence.db, 'insertOnce');
                const updateOnce = vi.spyOn(persistence.db, 'updateOnce');
                const queryBuilder = failQueryBuilderMutationOnce(persistence.source, 'insert');
                const now = Date.now();
                let insertedId: number;

                try {
                    insertedId = await harness.model.add({
                        allowEndLack: false,
                        timeSpecifiedOption: {
                            channelId: 10,
                            startAt: now + 30_000,
                            endAt: now + 40_000,
                            name: 'retry-one-domain-insert',
                        },
                    });
                } finally {
                    queryBuilder.queryBuilder.mockRestore();
                }

                expect(queryBuilder.mutation.execute).toHaveBeenCalledTimes(2);
                expect(retrier.attemptCount).toBe(retrier.runCount + 1);
                expect(insertOnce).toHaveBeenCalledOnce();
                expect(updateOnce).not.toHaveBeenCalled();
                expect(reserveEvent.emitUpdated).toHaveBeenCalledOnce();
                expect(reserveEvent.emitUpdated).toHaveBeenCalledWith({
                    insert: [expect.objectContaining({ id: insertedId!, name: 'retry-one-domain-insert' })],
                    isSuppressLog: false,
                });
                await expect(persistence.db.findId(insertedId!)).resolves.toMatchObject({
                    id: insertedId!,
                    name: 'retry-one-domain-insert',
                });
                await expect(persistence.db.findAll({ isHalfWidth: false })).resolves.toEqual([
                    [expect.objectContaining({ id: insertedId! })],
                    1,
                ]);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-T8.1][RM-1.3/RM-3.3] retries persistence once without repeating the domain update or event on %s',
        { timeout: 60_000 },
        async dialect => {
            const retrier = createRetryAfterOneFailure();
            const persistence = await createPersistence(dialect, { retry: retrier.retry });
            try {
                const reserveId = await persistence.db.insertOnce(makeReserve({ id: undefined, programId: 981 }));
                const reserveEvent = { emitUpdated: vi.fn() };
                const harness = makeModel({ reserveDB: persistence.db, reserveEvent });
                const insertOnce = vi.spyOn(persistence.db, 'insertOnce');
                const updateOnce = vi.spyOn(persistence.db, 'updateOnce');
                const queryBuilder = failQueryBuilderMutationOnce(persistence.source, 'update');

                try {
                    await harness.model.edit(reserveId, { allowEndLack: true, tags: ['retried-update'] });
                } finally {
                    queryBuilder.queryBuilder.mockRestore();
                }

                expect(queryBuilder.mutation.execute).toHaveBeenCalledTimes(2);
                expect(retrier.attemptCount).toBe(retrier.runCount + 1);
                expect(insertOnce).not.toHaveBeenCalled();
                expect(updateOnce).toHaveBeenCalledOnce();
                expect(reserveEvent.emitUpdated).toHaveBeenCalledOnce();
                expect(reserveEvent.emitUpdated).toHaveBeenCalledWith({
                    update: [
                        expect.objectContaining({ id: reserveId, allowEndLack: true, tags: '["retried-update"]' }),
                    ],
                    isSuppressLog: false,
                });
                await expect(persistence.db.findId(reserveId)).resolves.toMatchObject({
                    allowEndLack: true,
                    tags: '["retried-update"]',
                });
                await expect(persistence.db.findAll({ isHalfWidth: false })).resolves.toEqual([
                    [expect.objectContaining({ id: reserveId })],
                    1,
                ]);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-3.1] rolls delete and inserts back when a reservation diff fails on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const originalId = await persistence.db.insertOnce(makeReserve({ id: undefined, programId: 801 }));
                const duplicateA = makeReserve({ id: 900, programId: 802 });
                const duplicateB = makeReserve({ id: 900, programId: 803 });
                const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
                await expect(
                    persistence.db.updateMany({
                        delete: [makeReserve({ id: originalId })],
                        insert: [duplicateA, duplicateB],
                    }),
                ).rejects.toThrow('ReserveUpdateManyError');
                expect(await persistence.db.findId(originalId)).toMatchObject({ programId: 801 });
                expect(await persistence.db.findId(900)).toBeNull();
                error.mockRestore();
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-8.4] selects only reservations whose end is strictly before the cleanup time on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                await persistence.db.insertOnce(makeReserve({ id: undefined, endAt: 1_999 }));
                await persistence.db.insertOnce(makeReserve({ id: undefined, endAt: 2_000 }));
                await persistence.db.insertOnce(makeReserve({ id: undefined, endAt: 2_001 }));

                await expect(persistence.db.findOldTime(2_000)).resolves.toEqual([
                    expect.objectContaining({ endAt: 1_999 }),
                ]);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-8.4/RM-8.5] atomically deletes an expired reservation, preserves the survivor conflict, and normalizes the higher-priority reservation on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const ledger: string[] = [];
                const reserveEvent = { emitUpdated: vi.fn(() => ledger.push('event')) };
                const expiredId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, programId: 501, startAt: 0, endAt: 10 }),
                );
                const survivorId = await persistence.db.insertOnce(
                    makeReserve({
                        id: undefined,
                        programId: 502,
                        ruleId: 5,
                        channel: 'survivor-channel',
                        startAt: 5,
                        endAt: 20,
                        isConflict: true,
                    }),
                );
                const higherPriorityId = await persistence.db.insertOnce(
                    makeReserve({
                        id: undefined,
                        programId: 503,
                        ruleId: null,
                        isTimeSpecified: true,
                        channel: 'higher-priority-channel',
                        startAt: 15,
                        endAt: 25,
                        isConflict: true,
                    }),
                );
                const updateMany = vi.spyOn(persistence.db, 'updateMany');
                const harness = makeModel({ ledger, reserveDB: persistence.db, reserveEvent });
                harness.model.setTuners([{ types: ['GR'] }]);
                vi.useFakeTimers();
                vi.setSystemTime(15);

                try {
                    await harness.model.cleanup();
                } finally {
                    vi.useRealTimers();
                }

                expect(updateMany).toHaveBeenCalledOnce();
                expect(await persistence.db.findId(expiredId)).toBeNull();
                await expect(persistence.db.findId(survivorId)).resolves.toMatchObject({ isConflict: true });
                await expect(persistence.db.findId(higherPriorityId)).resolves.toMatchObject({ isConflict: false });
                expect(reserveEvent.emitUpdated).toHaveBeenCalledOnce();
                expect(reserveEvent.emitUpdated.mock.calls[0][0]).toMatchObject({
                    delete: [expect.objectContaining({ id: expiredId })],
                    update: [expect.objectContaining({ id: higherPriorityId, isConflict: false })],
                });
                expect(ledger).toEqual(['lock', 'unlock', 'event']);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each([
        ['delete', 'sqlite'],
        ['delete', 'mysql'],
        ['update', 'sqlite'],
        ['update', 'mysql'],
    ] as const)(
        '[RM-T8.1][RM-8.5] rolls the cleanup diff back, emits no event, and releases the mutation lock after a %s-stage failure on %s',
        { timeout: 60_000 },
        async (stage, dialect) => {
            const persistence = await createPersistence(dialect);
            try {
                const ledger: string[] = [];
                const reserveEvent = { emitUpdated: vi.fn(() => ledger.push('event')) };
                const expiredId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, programId: 601, startAt: 0, endAt: 10 }),
                );
                const survivorId = await persistence.db.insertOnce(
                    makeReserve({ id: undefined, programId: 602, startAt: 5, endAt: 20, isConflict: false }),
                );
                const createQueryRunner = persistence.source.createQueryRunner.bind(persistence.source);
                let failedStage: ReturnType<typeof vi.spyOn> | undefined;
                const queryRunner = vi.spyOn(persistence.source, 'createQueryRunner').mockImplementation(() => {
                    const runner = createQueryRunner();
                    failedStage = vi
                        .spyOn(runner.manager, stage)
                        .mockRejectedValueOnce(new Error(`synthetic ${stage} transaction failure`));
                    return runner;
                });
                const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
                const harness = makeModel({ ledger, reserveDB: persistence.db, reserveEvent });
                harness.model.setTuners([]);
                vi.useFakeTimers();
                vi.setSystemTime(15);

                try {
                    await expect(harness.model.cleanup()).rejects.toThrow('ReserveUpdateManyError');
                } finally {
                    vi.useRealTimers();
                    queryRunner.mockRestore();
                    error.mockRestore();
                }

                await expect(persistence.db.findId(expiredId)).resolves.toMatchObject({ id: expiredId });
                await expect(persistence.db.findId(survivorId)).resolves.toMatchObject({ isConflict: false });
                expect(failedStage).toHaveBeenCalledOnce();
                expect(reserveEvent.emitUpdated).not.toHaveBeenCalled();
                expect(ledger).toEqual(['lock', 'unlock']);
                expect(harness.execution.unLockExecution).toHaveBeenCalledExactlyOnceWith(7);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-T07][RM-5.1][#538] keeps no live reservation for a program whose rule reservation was skipped, and restores one when the skip is removed on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const programId = 881;
                const rules = [1, 2].map(id => ({
                    id,
                    updateCnt: 1,
                    isTimeSpecification: false,
                    searchOption: {},
                    reserveOption: { enable: true, allowEndLack: false },
                }));
                const program = makeReserve({ id: programId, programId, updateTime: 5, overlap: false });
                const harness = makeModel({
                    reserveDB: persistence.db,
                    programDB: { findId: vi.fn(async () => null), findRule: vi.fn(async () => [{ ...program }]) },
                    ruleDB: {
                        findId: vi.fn(async (id: number) => rules.find(rule => rule.id === id) ?? null),
                        getIds: vi.fn(async () => rules.map(rule => rule.id)),
                    },
                });
                harness.model.setTuners([{ types: ['GR'] }]);
                const rows = async () => (await persistence.db.findLists()).filter(row => row.programId === programId);
                const live = async () => (await rows()).filter(row => !row.isSkip && !row.isOverlap);

                // 両方のルールに一致する番組は、ルール 1 の予約 1 行にまとまる
                await harness.model.updateRule(1, true);
                await harness.model.updateRule(2, true);
                const [first] = await rows();
                expect(await rows()).toHaveLength(1);
                expect(first.ruleId).toBe(1);

                // ルール 1 の予約を除外すると、どのルールの更新でも生きた予約は作られない
                await harness.model.cancel(first.id);
                await harness.model.updateRule(2, true);
                await harness.model.updateRule(1, true);
                await harness.model.updateAll();
                expect(await live()).toEqual([]);
                await expect(persistence.db.findId(first.id)).resolves.toMatchObject({ ruleId: 1, isSkip: true });

                // 除外を解除すると、その番組の生きた予約が 1 行に戻る
                await harness.model.removeSkip(first.id);
                await harness.model.updateRule(2, true);
                await harness.model.updateAll();
                expect((await live()).map(row => row.ruleId)).toEqual([1]);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it.each(['sqlite', 'mysql'] as const)(
        '[RM-T07][RM-5.3][#538] removeSkip releases the skipped reservations of every rule for the program on %s',
        { timeout: 60_000 },
        async dialect => {
            const persistence = await createPersistence(dialect);
            try {
                const programId = 882;
                const rules = [1, 2].map(id => ({
                    id,
                    updateCnt: 1,
                    isTimeSpecification: false,
                    searchOption: {},
                    reserveOption: { enable: true, allowEndLack: false },
                }));
                const program = makeReserve({ id: programId, programId, updateTime: 5, overlap: false });
                const harness = makeModel({
                    reserveDB: persistence.db,
                    programDB: { findId: vi.fn(async () => null), findRule: vi.fn(async () => [{ ...program }]) },
                    ruleDB: {
                        findId: vi.fn(async (id: number) => rules.find(rule => rule.id === id) ?? null),
                        getIds: vi.fn(async () => rules.map(rule => rule.id)),
                    },
                });
                harness.model.setTuners([{ types: ['GR'] }]);

                // 番組単位の除外になる前の版で、両方のルールの予約が除外された状態
                const firstId = await persistence.db.insertOnce(
                    makeReserve({
                        id: undefined,
                        ruleId: 1,
                        ruleUpdateCnt: 1,
                        programId,
                        programUpdateTime: 5,
                        isSkip: true,
                    }),
                );
                await persistence.db.insertOnce(
                    makeReserve({
                        id: undefined,
                        ruleId: 2,
                        ruleUpdateCnt: 1,
                        programId,
                        programUpdateTime: 5,
                        isSkip: true,
                    }),
                );

                await harness.model.removeSkip(firstId);
                await harness.model.updateRule(1, true);
                await harness.model.updateRule(2, true);
                await harness.model.updateAll();

                const rows = (await persistence.db.findLists()).filter(row => row.programId === programId);
                expect(rows.map(row => [row.ruleId, row.isSkip])).toEqual([[1, false]]);
            } finally {
                await persistence.cleanup();
            }
        },
    );
});
