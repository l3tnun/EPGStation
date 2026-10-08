import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRepositoryPersistence } from '../persistence/repository-harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordedManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recorded/RecordedManageModel.js',
);
const RecordedTagManadeModel = load<new (...args: any[]) => any>(
    'model/operator/recordedTag/RecordedTagManadeModel.js',
);
const RecordedTagApiModel = load<new (...args: any[]) => any>('model/api/recordedTag/RecordedTagApiModel.js');
const RecorderModel = load<{ prototype: Record<string, unknown> }>('model/operator/recording/RecorderModel.js');

const logger = { getLogger: () => ({ system: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), fatal: vi.fn() } }) };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('recorded metadata specification', () => {
    it('[RC-5.1] creates, lists, updates, and deletes tags through the production models', async () => {
        const tagDB = {
            insertOnce: vi.fn(async () => 501),
            updateOnce: vi.fn(async () => undefined),
            deleteOnce: vi.fn(async () => undefined),
            findAll: vi.fn(async () => [[{ id: 501, name: 'Synthetic tag', color: '#123456' }], 1]),
        };
        const event = { emitCreated: vi.fn(), emitUpdated: vi.fn(), emitDeleted: vi.fn() };
        const manager = new RecordedTagManadeModel(logger, tagDB, event);
        const api = new RecordedTagApiModel({}, tagDB);

        await expect(manager.create('Ｓｙｎｔｈｅｔｉｃ tag', '#123456')).resolves.toBe(501);
        expect(tagDB.insertOnce.mock.calls[0][0]).toMatchObject({
            id: 501,
            name: 'Ｓｙｎｔｈｅｔｉｃ tag',
            halfWidthName: 'Synthetic tag',
            color: '#123456',
        });
        await expect(api.gets({ name: 'Synthetic' })).resolves.toEqual({
            tags: [{ id: 501, name: 'Synthetic tag', color: '#123456' }],
            total: 1,
        });
        expect(tagDB.findAll).toHaveBeenCalledWith({ name: 'Synthetic' });

        await manager.update(501, 'Synthetic updated', '#654321');
        await manager.delete(501);
        expect(tagDB.updateOnce).toHaveBeenCalledWith(501, 'Synthetic updated', '#654321');
        expect(tagDB.deleteOnce).toHaveBeenCalledWith(501);
        expect(event.emitUpdated).toHaveBeenCalledWith(501);
        expect(event.emitDeleted).toHaveBeenCalledWith(501);
    });

    it('[RC-5.2] persists tag relation changes before their notifications', async () => {
        const ledger: string[] = [];
        const tagDB = {
            setRelation: vi.fn(async () => ledger.push('relation-set')),
            deleteRelation: vi.fn(async () => ledger.push('relation-deleted')),
        };
        const event = {
            emitRelated: vi.fn(() => ledger.push('set-notified')),
            emitDeletedRelation: vi.fn(() => ledger.push('delete-notified')),
        };
        const manager = new RecordedTagManadeModel(logger, tagDB, event);

        await manager.setRelation(502, 503);
        await manager.deleteRelation(502, 503);

        expect(ledger).toEqual(['relation-set', 'set-notified', 'relation-deleted', 'delete-notified']);
        expect(tagDB.setRelation).toHaveBeenCalledWith(502, 503);
        expect(tagDB.deleteRelation).toHaveBeenCalledWith(502, 503);
        expect(event.emitRelated).toHaveBeenCalledWith(502, 503);
        expect(event.emitDeletedRelation).toHaveBeenCalledWith(502, 503);
    });

    it('[RC-5.3] persists the requested protection value before notifying its recorded id', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);
        const ledger: string[] = [];
        target.log = { system: { info: vi.fn() } };
        target.recordedDB = {
            changeProtect: vi.fn(async () => ledger.push('protect-persisted')),
        };
        target.recordedEvent = { emitChangeProtect: vi.fn(() => ledger.push('protect-notified')) };

        await target.changeProtect(504, true);

        expect(ledger).toEqual(['protect-persisted', 'protect-notified']);
        expect(target.recordedDB.changeProtect).toHaveBeenCalledWith(504, true);
        expect(target.recordedEvent.emitChangeProtect).toHaveBeenCalledWith(504, true);
    });

    it('[RC-5.3] persists a protection removal before notifying its recorded id', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);
        const infoLog = vi.fn();
        const ledger: string[] = [];
        target.log = { system: { info: infoLog } };
        target.recordedDB = {
            changeProtect: vi.fn(async () => ledger.push('protect-persisted')),
        };
        target.recordedEvent = { emitChangeProtect: vi.fn(() => ledger.push('protect-notified')) };

        await target.changeProtect(505, false);

        expect(ledger).toEqual(['protect-persisted', 'protect-notified']);
        expect(target.recordedDB.changeProtect).toHaveBeenCalledWith(505, false);
        expect(target.recordedEvent.emitChangeProtect).toHaveBeenCalledWith(505, false);
        expect(infoLog).toHaveBeenCalledWith('remove protect: 505');
    });

    it('[RC-5.6] unlinks only the requested reservation-rule id from saved recordings', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);
        target.recordedDB = { removeRuleId: vi.fn(async () => undefined) };

        await target.removeRuleId(505);

        expect(target.recordedDB.removeRuleId).toHaveBeenCalledWith(505);
    });

    it('[RC-5.4] rejects protected whole-recording deletion before any destructive effect', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);
        target.log = { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
        target.recordedDB = {
            findId: vi.fn(async () => ({ id: 506, isProtected: true, videoFiles: [{ id: 507 }] })),
            deleteOnce: vi.fn(),
        };
        target.videoFileDB = { findId: vi.fn(async () => ({ id: 507, recordedId: 506 })), deleteOnce: vi.fn() };
        target.videoUtil = { getFullFilePathFromId: vi.fn() };
        target.recordedEvent = { emitDeleteRecorded: vi.fn(), emitDeleteVideoFile: vi.fn() };

        await expect(target.delete(506)).rejects.toThrow('RecordedIsProtected');

        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteRecorded).not.toHaveBeenCalled();
    });

    it('[RC-5.5] rejects protected individual-file deletion before any destructive effect', async () => {
        const target: any = Object.create(RecordedManageModel.prototype);
        target.log = { system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
        target.recordedDB = {
            findId: vi.fn(async () => ({ id: 506, isProtected: true, videoFiles: [{ id: 507 }] })),
            deleteOnce: vi.fn(),
        };
        target.videoFileDB = { findId: vi.fn(async () => ({ id: 507, recordedId: 506 })), deleteOnce: vi.fn() };
        target.videoUtil = { getFullFilePathFromId: vi.fn() };
        target.recordedEvent = { emitDeleteRecorded: vi.fn(), emitDeleteVideoFile: vi.fn() };

        await expect(target.deleteVideoFile(507)).rejects.toThrow('RecordedIsProtected');

        expect(target.recordedDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoFileDB.deleteOnce).not.toHaveBeenCalled();
        expect(target.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(target.recordedEvent.emitDeleteVideoFile).not.toHaveBeenCalled();
    });

    it.each([
        ['eligible rule reservation', false, 508, false, true, 1],
        ['time-specified reservation', true, 508, false, true, 0],
        ['manual reservation', false, null, false, true, 0],
        ['event relay reservation', false, 508, true, true, 0],
        ['retained reservation', false, 508, false, false, 0],
    ])(
        'records history only for an %s',
        async (_label, isTimeSpecified, ruleId, isEventRelay, isNeedDeleteReservation, expected) => {
            const target: any = Object.create(RecorderModel.prototype);
            target.log = { system: { info: vi.fn(), error: vi.fn(), fatal: vi.fn() }, stream: { fatal: vi.fn() } };
            target.destroyStream = vi.fn();
            target.scheduleBinding = null;
            target.retryTimerId = null;
            target.retryAttempt = null;
            target.retryLifecycleToken = 0n;
            target.preparationLifetime = null;
            target.deletionStop = null;
            target.isDropCheckerActive = false;
            target.dropCheckerStopLifetime = null;
            target.finalizationLifetime = null;
            target.finalizationContinuations = new Set();
            target.pendingRegistrationResources = null;
            target.eventRelayTimerId = null;
            target.isPlanToDelete = false;
            target.recordedId = 509;
            target.videoFileId = null;
            target.videoFileFulPath = null;
            target.dropLogFileId = null;
            target.config = {};
            target.isNeedDeleteReservation = isNeedDeleteReservation;
            target.reserve = { id: 510, isTimeSpecified, ruleId, isEventRelay };
            target.recordedDB = {
                removeRecording: vi.fn(async () => undefined),
                findId: vi.fn(async () => ({ halfWidthName: '[新]Synthetic', channelId: 101, endAt: 20_000 })),
            };
            target.updateDropFileLog = vi.fn(async () => undefined);
            target.recordedHistoryDB = { insertOnce: vi.fn(async () => 511) };
            target.recordingEvent = { emitFinishRecording: vi.fn() };

            await target.recEnd();

            expect(target.recordedHistoryDB.insertOnce).toHaveBeenCalledTimes(expected);
            if (expected === 1) {
                expect(target.recordedHistoryDB.insertOnce.mock.calls[0][0]).toMatchObject({
                    name: 'Synthetic',
                    channelId: 101,
                    endAt: 20_000,
                });
            }
        },
    );

    it('[RC-6.1] adds name, channel, and completion time for an eligible completed rule recording', async () => {
        const target: any = Object.create(RecorderModel.prototype);
        target.log = { system: { info: vi.fn(), error: vi.fn(), fatal: vi.fn() }, stream: { fatal: vi.fn() } };
        target.config = {};
        target.deletionStop = null;
        target.destroyStream = vi.fn();
        target.dropCheckerStopLifetime = null;
        target.dropLogFileId = null;
        target.eventRelayTimerId = null;
        target.finalizationContinuations = new Set();
        target.finalizationLifetime = null;
        target.isDropCheckerActive = false;
        target.isNeedDeleteReservation = true;
        target.isPlanToDelete = false;
        target.pendingRegistrationResources = null;
        target.preparationLifetime = null;
        target.recordedId = 509;
        target.recordedDB = {
            findId: vi.fn(async () => ({ channelId: 101, endAt: 20_000, halfWidthName: '[new]Synthetic' })),
            removeRecording: vi.fn(async () => undefined),
        };
        target.recordedHistoryDB = { insertOnce: vi.fn(async () => 511) };
        target.recordingEvent = { emitFinishRecording: vi.fn() };
        target.reserve = { id: 510, isEventRelay: false, isTimeSpecified: false, ruleId: 508 };
        target.retryAttempt = null;
        target.retryLifecycleToken = 0n;
        target.retryTimerId = null;
        target.scheduleBinding = null;
        target.updateDropFileLog = vi.fn(async () => undefined);
        target.videoFileFulPath = null;
        target.videoFileId = null;

        await target.recEnd();

        expect(target.recordedHistoryDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 101, endAt: 20_000, name: 'Synthetic' }),
        );
    });

    it.each(['[RC-6.2]', '[RC-6.3]'])(
        '%s exposes overlap only for the same name and channel within the duplicate period',
        async () => {
            const now = 1_000_000_000;
            const day = 24 * 60 * 60 * 1000;
            vi.spyOn(Date.prototype, 'getTime').mockReturnValue(now);
            const persistence = await createRepositoryPersistence('sqlite');
            const program = (id: number, channelId: number, shortName: string, startAt: number, endAt: number) => ({
                channel: 'Synthetic channel',
                channelId,
                channelType: 'GR',
                duration: endAt - startAt,
                endAt,
                eventId: id,
                halfWidthName: 'selected program',
                id,
                isFree: true,
                name: 'Selected program',
                networkId: 1,
                serviceId: 1,
                shortName,
                startAt,
                startHour: 0,
                updateTime: now,
                week: 0,
            });
            try {
                await persistence.source
                    .getRepository(persistence.entities.Program)
                    .insert([
                        program(601, 101, 'period-match', now, now + day),
                        program(602, 101, 'period-outside', now + day, now + day * 2),
                        program(603, 101, 'name-mismatch', now + day * 2, now + day * 3),
                        program(604, 102, 'channel-mismatch', now + day * 3, now + day * 4),
                    ]);
                await persistence.source.getRepository(persistence.entities.RecordedHistory).insert([
                    { channelId: 101, endAt: now - day * 3, name: 'period-match' },
                    { channelId: 101, endAt: now - day * 8, name: 'period-outside' },
                    { channelId: 101, endAt: now - day * 3, name: 'different-name' },
                    { channelId: 101, endAt: now - day * 3, name: 'channel-mismatch' },
                ]);

                const result = await persistence.db.ProgramDB.findRule({
                    reserveOption: { avoidDuplicate: true, periodToAvoidDuplicate: 7 },
                    searchOption: { keyword: 'selected', name: true },
                });

                expect(result.map(({ id, overlap }: { id: number; overlap: boolean }) => ({ id, overlap }))).toEqual([
                    { id: 601, overlap: true },
                    { id: 602, overlap: false },
                    { id: 603, overlap: false },
                    { id: 604, overlap: false },
                ]);
            } finally {
                await persistence.cleanup();
            }
        },
    );

    it('[RC-6.4] deletes history older than the configured retention cutoff', async () => {
        vi.spyOn(Date.prototype, 'getTime').mockReturnValue(2_000_000_000);
        const target: any = Object.create(RecordedManageModel.prototype);
        target.config = { recordedHistoryRetentionPeriodDays: 7 };
        target.log = { system: { error: vi.fn() } };
        target.recordedHistoryDB = { delete: vi.fn(async () => undefined) };

        await target.historyCleanup();

        expect(target.recordedHistoryDB.delete).toHaveBeenCalledWith(2_000_000_000 - 7 * 24 * 60 * 60 * 1000);
    });
});

describe('recorded tag api model facade delegation', () => {
    it('delegates create to the ipc client and returns its assigned tag id', async () => {
        const ipc = { recordedTag: { create: vi.fn(async () => 601) } };
        const api = new RecordedTagApiModel(ipc, {});

        await expect(api.create('Synthetic tag', '#abcdef')).resolves.toBe(601);

        expect(ipc.recordedTag.create).toHaveBeenCalledWith('Synthetic tag', '#abcdef');
    });

    it('delegates update to the ipc client', async () => {
        const ipc = { recordedTag: { update: vi.fn(async () => undefined) } };
        const api = new RecordedTagApiModel(ipc, {});

        await expect(api.update(602, 'Updated tag', '#123123')).resolves.toBeUndefined();

        expect(ipc.recordedTag.update).toHaveBeenCalledWith(602, 'Updated tag', '#123123');
    });

    it('delegates setRelation to the ipc client', async () => {
        const ipc = { recordedTag: { setRelation: vi.fn(async () => undefined) } };
        const api = new RecordedTagApiModel(ipc, {});

        await expect(api.setRelation(603, 604)).resolves.toBeUndefined();

        expect(ipc.recordedTag.setRelation).toHaveBeenCalledWith(603, 604);
    });

    it('delegates delete to the ipc client', async () => {
        const ipc = { recordedTag: { delete: vi.fn(async () => undefined) } };
        const api = new RecordedTagApiModel(ipc, {});

        await expect(api.delete(605)).resolves.toBeUndefined();

        expect(ipc.recordedTag.delete).toHaveBeenCalledWith(605);
    });

    it('delegates deleteRelation to the ipc client', async () => {
        const ipc = { recordedTag: { deleteRelation: vi.fn(async () => undefined) } };
        const api = new RecordedTagApiModel(ipc, {});

        await expect(api.deleteRelation(606, 607)).resolves.toBeUndefined();

        expect(ipc.recordedTag.deleteRelation).toHaveBeenCalledWith(606, 607);
    });
});
