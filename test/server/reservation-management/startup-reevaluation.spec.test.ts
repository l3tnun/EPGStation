import { describe, expect, it, vi } from 'vitest';

import { EventSetter, makeModel, makeReserve, ReserveEvent } from './_harness';

const flushEvent = async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

// 実物の `ReserveEvent` と `EventSetter` をつなぎ、録画側と外部 command 側の受け口だけを spy にする。
const wireEventSetter = () => {
    const logger = { system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const event = new ReserveEvent({ getLogger: () => logger });
    const port = new Proxy({}, { get: () => vi.fn() });
    // 予約変更コマンドは addUpdateReseves に渡された update の一件ごとに一回実行される。
    const recordingManage = { acceptMutation: vi.fn() };
    const externalCommandManage = { addUpdateReseves: vi.fn() };
    new EventSetter(
        { getLogger: () => logger },
        port,
        port,
        port,
        event,
        port,
        port,
        port,
        port,
        port,
        recordingManage,
        port,
        port,
        port,
        externalCommandManage,
        { notifyClient: vi.fn(), setEncode: vi.fn() },
        { getConfig: () => ({ recorded: [{ name: 'synthetic-root' }] }) },
        { setup: vi.fn() },
    ).set();
    return { event, externalCommandManage, recordingManage };
};

describe('reservation startup re-evaluation snapshot', () => {
    it('[RM-AUX-8.2/RM-AUX-8.7][Task 6.4] emits the persisted normal, conflict, and skipped snapshot through the public reserve event', async () => {
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const delivered = vi.fn();
        event.setUpdated(delivered);

        const now = Date.now();
        const program = makeReserve({ id: 91, programId: 901, startAt: now + 100_000, endAt: now + 160_000 });
        const timeManual = makeReserve({
            id: 92,
            channel: 'time-manual-channel',
            endAt: now + 150_000,
            isTimeSpecified: true,
            programId: null,
            startAt: now + 120_000,
        });
        const skippedOverlap = makeReserve({
            id: 93,
            isOverlap: true,
            isSkip: true,
            programId: 903,
            startAt: now + 170_000,
            endAt: now + 190_000,
        });
        const saved = [program, timeManual, skippedOverlap];
        const harness = makeModel({ reserveEvent: event });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findLists.mockImplementation(async () => saved.map(reserve => ({ ...reserve })));
        harness.reserveDB.updateMany.mockImplementation(async diff => {
            for (const reserve of diff.update) {
                const index = saved.findIndex(savedReserve => savedReserve.id === reserve.id);
                saved[index] = reserve;
            }
        });

        await harness.model.updateAll(true);
        await flushEvent();

        expect(harness.reserveDB.findLists).toHaveBeenCalledTimes(2);
        expect(delivered).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                isStartupRebuild: true,
                update: expect.arrayContaining([
                    expect.objectContaining({ id: 91, isConflict: true, isEventRelay: false }),
                    expect.objectContaining({ id: 92, isConflict: false, isEventRelay: false, isTimeSpecified: true }),
                    expect.objectContaining({ id: 93, isOverlap: true, isSkip: true }),
                ]),
            }),
        );
    });

    it('[RM-AUX-8.5/RM-AUX-8.7] hands the whole persisted snapshot to the recording side on startup but gives the external update command only reservations that really changed', async () => {
        const { event, externalCommandManage, recordingManage } = wireEventSetter();

        const now = Date.now();
        const program = makeReserve({ id: 95, programId: 905, startAt: now + 100_000, endAt: now + 160_000 });
        const timeManual = makeReserve({
            id: 96,
            channel: 'time-manual-channel',
            endAt: now + 260_000,
            isTimeSpecified: true,
            programId: null,
            startAt: now + 200_000,
        });
        const saved = [program, timeManual];
        const harness = makeModel({ reserveEvent: event });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findLists.mockImplementation(async () => saved.map(reserve => ({ ...reserve })));

        await harness.model.updateAll(true);
        await flushEvent();

        // 録画側は、時刻指定手動予約の timer を組み直すために保存済みの全予約を受け取る。
        const recordingUpdates = recordingManage.acceptMutation.mock.calls.flatMap(
            ([diff]: [{ update?: Array<{ id: number }> }]) => (diff.update ?? []).map(reserve => reserve.id),
        );
        expect(recordingUpdates.sort((a, b) => a - b)).toEqual([95, 96]);

        // 何も変わっていない予約では、予約変更コマンドを一回も実行しない（送り直しを変更として扱わない）。
        const commandUpdates = externalCommandManage.addUpdateReseves.mock.calls.flatMap(
            ([diff]: [{ update?: Array<{ id: number }> }]) => (diff.update ?? []).map(reserve => reserve.id),
        );
        expect(commandUpdates).toEqual([]);
    });

    it('rejects updateAll() when the manual-reservation id lookup itself fails', async () => {
        const harness = makeModel();
        const failure = new Error('synthetic getManualIds failure');
        harness.reserveDB.getManualIds.mockRejectedValue(failure);

        await expect(harness.model.updateAll()).rejects.toBe(failure);
    });

    it('rejects updateAll() when the rule event-relay id lookup itself fails', async () => {
        const harness = makeModel();
        const failure = new Error('synthetic getRuleEventRelayIds failure');
        harness.reserveDB.getRuleEventRelayIds.mockRejectedValue(failure);

        await expect(harness.model.updateAll()).rejects.toBe(failure);
    });

    it('rejects updateAll() when the rule id lookup itself fails', async () => {
        const harness = makeModel();
        const failure = new Error('synthetic getIds failure');
        harness.ruleDB.getIds.mockRejectedValue(failure);

        await expect(harness.model.updateAll()).rejects.toBe(failure);
    });

    it('continues updateAll() past a per-item update() failure sourced from rule event-relay ids', async () => {
        const harness = makeModel();
        harness.reserveDB.getRuleEventRelayIds.mockResolvedValue([77]);
        harness.reserveDB.findId.mockImplementation(async (id: number) => {
            if (id === 77) throw new Error('synthetic per-item update failure');

            return null;
        });

        await expect(harness.model.updateAll()).resolves.toBeUndefined();

        expect(harness.log.system.error).toHaveBeenCalled();
        expect(harness.reserveDB.findLists).toHaveBeenCalled();
    });

    it('[RM-AUX-8.2][Task 6.4] sends only the recalculated diff outside the initial startup pass', async () => {
        const event = new ReserveEvent({ getLogger: () => ({ system: { error: vi.fn() } }) });
        const delivered = vi.fn();
        event.setUpdated(delivered);

        const now = Date.now();
        const stable = makeReserve({ id: 94, programId: 904, startAt: now + 100_000, endAt: now + 160_000 });
        const harness = makeModel({ reserveEvent: event });
        harness.model.setTuners([{ types: ['GR'] }]);
        harness.reserveDB.findLists.mockResolvedValue([stable]);

        await harness.model.updateAll(false);
        await flushEvent();

        expect(harness.reserveDB.findLists).toHaveBeenCalledOnce();
        expect(delivered).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ delete: [], insert: [], isSuppressLog: false, update: [] }),
        );
        expect(delivered.mock.calls[0]?.[0]).not.toHaveProperty('isStartupRebuild');
    });

    it('[RM-AUX-8.5] keeps passing the inserts and deletes of a startup rebuild diff to the external commands and gives them no update', () => {
        const { event, externalCommandManage, recordingManage } = wireEventSetter();
        const inserted = makeReserve({ id: 97 });
        const deleted = makeReserve({ id: 98 });
        const rebuilt = makeReserve({ id: 99 });

        event.emitUpdated({
            delete: [deleted],
            insert: [inserted],
            isStartupRebuild: true,
            isSuppressLog: false,
            update: [rebuilt],
        });

        expect(recordingManage.acceptMutation).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ update: [rebuilt] }),
        );
        expect(externalCommandManage.addUpdateReseves).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ delete: [deleted], insert: [inserted], update: [] }),
        );
    });

    it('[RM-AUX-8.5] passes an ordinary reservation diff to both the recording side and the external commands unchanged', () => {
        const { event, externalCommandManage, recordingManage } = wireEventSetter();
        const diff = { delete: [], insert: [], isSuppressLog: false, update: [makeReserve({ id: 100 })] };

        event.emitUpdated(diff);

        expect(recordingManage.acceptMutation).toHaveBeenCalledExactlyOnceWith(diff);
        expect(externalCommandManage.addUpdateReseves).toHaveBeenCalledExactlyOnceWith(diff);
    });
});
