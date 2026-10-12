import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createPersistence, load, makeModel, makeReserve, ReserveEvent } from './_harness';

/*
 * 予約管理の test の予約は `new Reserve()` の instance で、予約の更新を受ける録画側は `acceptMutation` の vi.fn か、
 * 差分を受けるだけの consumer である。本物の ReserveDB（better-sqlite3）の上で予約管理の操作を流し、本物の
 * ReserveEvent で本物の RecordingManageModel へ渡し、録画側が作る候補の写しが DB の行と同じ値になることを確かめる。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const RecordingManageModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'recording',
    'RecordingManageModel.js',
);
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT!;
const { default: ReserveEntity } = require(join(snapshot, 'db', 'entities', 'Reserve.js')) as {
    default: new () => Record<string, unknown>;
};

const logger = {
    system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    stream: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
};

const comparedFields = [
    'id',
    'programId',
    'ruleId',
    'channelId',
    'startAt',
    'endAt',
    'name',
    'isSkip',
    'isConflict',
    'isOverlap',
    'isTimeSpecified',
    'isEventRelay',
    'allowEndLack',
    'tags',
    'recordedFormat',
    'parentDirectoryName',
    'directory',
] as const;

const pick = (row: Record<string, unknown>) => Object.fromEntries(comparedFields.map(field => [field, row[field]]));

describe('reservation instance double against the copies the recording side keeps', () => {
    it('[RM-DOUBLE-PARITY-HANDOFF] keeps recording candidates equal to the real sqlite rows across add, edit, conflict, and cancel', async () => {
        const persistence = await createPersistence('sqlite');
        const now = Date.now();
        const program = (id: number, startOffset: number, channelId = 10) =>
            makeReserve({
                id,
                programId: id,
                channelId,
                channel: `synthetic-channel-${channelId}`,
                startAt: now + startOffset,
                endAt: now + startOffset + 600_000,
                name: `synthetic-program-${id}`,
            });
        const programs: Record<number, Record<string, unknown>> = {
            501: program(501, 3_600_000),
            502: program(502, 7_200_000),
            503: program(503, 3_600_000, 11),
            504: program(504, 4_200_000),
        };
        const reserveEvent = new ReserveEvent({ getLogger: () => logger });
        const harness = makeModel({
            reserveDB: persistence.db,
            reserveEvent,
            programDB: { findId: vi.fn(async (id: number) => programs[id] ?? null), findRule: vi.fn() },
        });
        harness.model.setTuners([{ types: ['GR'] }]);
        const recording = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
            vi.fn(),
            {
                setCancelPrepRecording: vi.fn(),
                setPrepRecordingFailed: vi.fn(),
                setRecordingFailed: vi.fn(),
                setFinishRecording: vi.fn(),
            },
            { setTuner: vi.fn() },
            { findAll: vi.fn(async () => [[], 0]) },
            persistence.db,
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        reserveEvent.setUpdated((diff: any) => recording.acceptMutation(diff));

        const candidatesMatchRows = async () => {
            await (recording as any).scheduleController.whenIdle();
            const [rows] = (await persistence.db.findAll({ isHalfWidth: false })) as [Array<Record<string, unknown>>];
            const recordable = rows.filter(row => row.isSkip !== true && row.isOverlap !== true);
            const candidates = (recording as any).candidateRegistry.list() as Array<{
                reservation: Record<string, unknown>;
            }>;
            for (const candidate of candidates) {
                expect(candidate.reservation).not.toBeInstanceOf(ReserveEntity);
                expect(Object.isFrozen(candidate.reservation)).toBe(true);
            }
            expect(
                candidates.map(candidate => pick(candidate.reservation)).sort((a: any, b: any) => a.id - b.id),
            ).toEqual(recordable.map(pick).sort((a: any, b: any) => (a.id as number) - (b.id as number)));
            return candidates.length;
        };

        try {
            await recording.rebuildCandidatesAndStart();
            await expect(candidatesMatchRows()).resolves.toBe(0);

            const first = await harness.model.add({ programId: 501, allowEndLack: false });
            await expect(candidatesMatchRows()).resolves.toBe(1);

            await harness.model.add({ programId: 502, allowEndLack: true, tags: [3] });
            await expect(candidatesMatchRows()).resolves.toBe(2);

            await harness.model.edit(first, { allowEndLack: true, tags: [7] });
            await expect(candidatesMatchRows()).resolves.toBe(2);

            // 新規自身が競合する手動追加は拒否し、DB と録画候補のどちらにも残さない。
            await expect(harness.model.add({ programId: 503, allowEndLack: false })).rejects.toThrow(
                'ReservationManageModelAddReserveConflict',
            );
            await expect(persistence.db.findProgramId(503)).resolves.toEqual([]);
            await expect(candidatesMatchRows()).resolves.toBe(2);

            // 追加が成功した後に tuner が減ると、保存済み予約は競合になっても録画候補に残る。
            harness.model.setTuners([{ types: ['GR'] }, { types: ['GR'] }]);
            const conflicting = await harness.model.add({ programId: 503, allowEndLack: false });
            expect(conflicting).toEqual(expect.any(Number));
            expect(conflicting).toBeGreaterThan(0);
            harness.model.setTuners([{ types: ['GR'] }]);
            await harness.model.updateAll();
            await expect(candidatesMatchRows()).resolves.toBe(3);
            await expect(persistence.db.findId(conflicting)).resolves.toMatchObject({
                id: conflicting,
                programId: 503,
                isConflict: true,
            });
            expect((recording as any).candidateRegistry.list()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        reservation: expect.objectContaining({ id: conflicting, isConflict: true }),
                    }),
                ]),
            );

            // 既存の競合が終わる境界からの追加は成功し、同じ ID の候補を録画側へ渡す。
            const unrelated = await harness.model.add({ programId: 504, allowEndLack: false });
            expect(unrelated).toBeGreaterThan(0);
            await expect(candidatesMatchRows()).resolves.toBe(4);
            await expect(persistence.db.findId(unrelated)).resolves.toMatchObject({ id: unrelated, isConflict: false });
            expect((recording as any).candidateRegistry.list()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        reservation: expect.objectContaining({ id: unrelated, isConflict: false }),
                    }),
                ]),
            );

            await harness.model.cancel(first);
            await candidatesMatchRows();
            await expect(persistence.db.findId(first)).resolves.toBeNull();
        } finally {
            (recording as any).scheduleController.stop();
            await persistence.cleanup();
        }
    }, 60_000);

    it('[RM-1.6] hands no recording to the recorder for excluded or overlap rows stored in sqlite, and starts one once the exclusion is removed', async () => {
        const persistence = await createPersistence('sqlite');
        const now = Date.now();
        // 開始時刻を過ぎた番組（放送中）なので、候補になれば録画側はすぐ準備を始める。
        const live = (overrides: Record<string, unknown>) =>
            makeReserve({
                ...overrides,
                id: undefined,
                channelId: 10,
                startAt: now - 1_000,
                endAt: now + 600_000,
                ruleId: 1,
                isTimeSpecified: false,
                isEventRelay: false,
            });
        const normalId = await persistence.db.insertOnce(live({ programId: 601, name: 'normal' }));
        const skippedId = await persistence.db.insertOnce(live({ programId: 602, name: 'skipped', isSkip: true }));
        const overlapId = await persistence.db.insertOnce(live({ programId: 603, name: 'overlap', isOverlap: true }));
        const bothId = await persistence.db.insertOnce(
            live({ programId: 604, name: 'conflict and overlap', isConflict: true, isOverlap: true }),
        );
        const conflictId = await persistence.db.insertOnce(
            live({ programId: 605, name: 'conflict only', isConflict: true }),
        );

        const reserveEvent = new ReserveEvent({ getLogger: () => logger });
        const harness = makeModel({
            reserveDB: persistence.db,
            reserveEvent,
            programDB: { findId: vi.fn(async () => null), findRule: vi.fn() },
        });
        harness.model.setTuners([{ types: ['GR'] }, { types: ['GR'] }, { types: ['GR'] }]);
        const startedRecorders: number[] = [];
        const preparationStarts: number[] = [];
        const provider = vi.fn(async () => {
            let reserveId = -1;
            return {
                setTimer: vi.fn((reserve: { id: number }) => {
                    reserveId = reserve.id;
                    startedRecorders.push(reserve.id);
                    return true;
                }),
                startPreparation: vi.fn(async () => {
                    preparationStarts.push(reserveId);
                }),
                setSessionContext: vi.fn(),
                cancel: vi.fn(),
                destroy: vi.fn(),
            };
        });
        const recording = new RecordingManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
            provider,
            {
                setCancelPrepRecording: vi.fn(),
                setPrepRecordingFailed: vi.fn(),
                setRecordingFailed: vi.fn(),
                setFinishRecording: vi.fn(),
            },
            { setTuner: vi.fn() },
            { findAll: vi.fn(async () => [[], 0]) },
            persistence.db,
            { movingFromTmp: vi.fn(), updateVideoFileSize: vi.fn().mockResolvedValue(undefined) },
        );
        reserveEvent.setUpdated((diff: any) => recording.acceptMutation(diff));
        const settle = async () => {
            await (recording as any).scheduleController.whenIdle();
            await new Promise(resolve => setTimeout(resolve, 50));
            await (recording as any).scheduleController.whenIdle();
        };

        try {
            await recording.rebuildCandidatesAndStart();
            await settle();

            const candidateIds = ((recording as any).candidateRegistry.list() as Array<{ reservationId: number }>)
                .map(candidate => candidate.reservationId)
                .sort((a, b) => a - b);
            expect(candidateIds).toEqual([normalId, conflictId].sort((a, b) => a - b));
            expect([...startedRecorders].sort((a, b) => a - b)).toEqual([normalId, conflictId].sort((a, b) => a - b));
            expect(startedRecorders).not.toContain(skippedId);
            expect(startedRecorders).not.toContain(overlapId);
            expect(startedRecorders).not.toContain(bothId);

            // 除外を解除すると、その予約は録画候補になり録画側が受け取る。
            await harness.model.removeSkip(skippedId);
            await settle();
            await expect(persistence.db.findId(skippedId)).resolves.toMatchObject({ isSkip: false });
            expect(startedRecorders).toContain(skippedId);
            expect(startedRecorders).not.toContain(overlapId);
            expect(startedRecorders).not.toContain(bothId);
        } finally {
            (recording as any).scheduleController.stop();
            await persistence.cleanup();
        }
    }, 60_000);
});
