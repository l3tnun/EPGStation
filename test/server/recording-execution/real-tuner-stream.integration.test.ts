import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeReserve, RecordingStreamCreator } from './_harness';
import { createRealTuner, type SyntheticTunerServer } from './_real-tuner-wiring';

/*
 * 録画の放送ストリームの取得（`RecordingStreamCreator`）を、本物の `TunerServerAccessModel` と、実 HTTP で応答する
 * tuner server の代わり（`SyntheticTunerServer`）の上で確かめる。stream の request が届く時刻・header・件数、
 * stream の応答が切られる時刻は、server が受け取った実測で見る。時計は実時計。
 */

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
});

const createLog = () => ({
    system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

const createFixture = async (tunerCount: number, config: Record<string, unknown> = {}) => {
    const tuner = await createRealTuner({ establishmentTimeoutMs: 5_000 });
    cleanups.push(() => tuner.close());
    const log = createLog();
    const creator = new RecordingStreamCreator(
        { getLogger: () => log },
        {
            getConfig: () => ({
                conflictPriority: 9,
                recPriority: 2,
                timeSpecifiedEndMargin: 0,
                timeSpecifiedStartMargin: 0,
                ...config,
            }),
        },
        tuner.access,
    );
    creator.setTuner(Array.from({ length: tunerCount }, () => ({ types: ['GR'] })));
    return { creator, log, server: tuner.server };
};

const closeStreamLater = (stream: { destroy(): void }): void => {
    cleanups.push(() => stream.destroy());
};

const tunerProgram = (id: number, endsInMs: number) => ({
    id,
    eventId: id + 1,
    serviceId: 102,
    networkId: 10,
    startAt: Date.now() + endsInMs - 60_000,
    duration: 60_000,
    isFree: true,
    name: `synthetic-program-${id}`,
});

const occupancyWarnings = (log: ReturnType<typeof createLog>): number =>
    log.system.warn.mock.calls.filter(([message]) => String(message).startsWith('TunerAssignmentError')).length;

describe('priority of the stream request that reaches a real tuner server', () => {
    it('[RE-REAL-PRIORITY] sends the recording priority for a normal reservation and the conflict priority for a conflict reservation, for both program and time-specified reservations', async () => {
        const { creator, server } = await createFixture(4, { conflictPriority: 9, recPriority: 2 });
        const now = Date.now();
        const reservations = [
            makeReserve({ id: 1, programId: 101, channel: 'a', channelId: 11 }),
            makeReserve({ id: 2, programId: 102, channel: 'b', channelId: 12, isConflict: true }),
            makeReserve({
                id: 3,
                programId: null,
                isTimeSpecified: true,
                channel: 'c',
                channelId: 13,
                startAt: now - 1_000,
                endAt: now + 60_000,
            }),
            makeReserve({
                id: 4,
                programId: null,
                isTimeSpecified: true,
                isConflict: true,
                channel: 'd',
                channelId: 14,
                startAt: now - 1_000,
                endAt: now + 60_000,
            }),
        ];
        for (const reservation of reservations) closeStreamLater(await creator.create(reservation));

        const priority = (kind: 'program' | 'service', id: number) =>
            server.streamRequests(kind, id).map(request => request.headers['x-mirakurun-priority']);
        expect({
            normalProgram: priority('program', 101),
            conflictProgram: priority('program', 102),
            normalTimeSpecified: priority('service', 13),
            conflictTimeSpecified: priority('service', 14),
        }).toEqual({
            normalProgram: ['2'],
            conflictProgram: ['9'],
            normalTimeSpecified: ['2'],
            conflictTimeSpecified: ['9'],
        });
    }, 30_000);
});

describe('tuner occupancy that the recording stream creator keeps while a stream is being opened', () => {
    it('[RE-REAL-OCCUPANCY] makes a second preparation see the occupied tuner while the first stream is still opening, and frees it when the first stream fails', async () => {
        const { creator, log, server } = await createFixture(1);
        server.behave('program', 21, { kind: 'status', status: 503, delayMs: 600 });
        const first = makeReserve({ id: 21, programId: 21, channel: 'ch-a', endAt: Date.now() + 120_000 });
        const pending = creator.create(first).then(
            () => 'opened',
            (error: Error) => error.message,
        );
        await vi.waitFor(() => expect(server.streamRequests('program', 21)).toHaveLength(1));

        // 最初の stream の応答を待っている間に始まる別の放送波の準備は、tuner が使われていると判断する。
        const during = makeReserve({ id: 22, programId: 22, channel: 'ch-b', endAt: Date.now() + 120_000 });
        closeStreamLater(await creator.create(during));
        expect(occupancyWarnings(log)).toBe(1);

        // 最初の stream が失敗すると占有が解放され、次の準備は tuner を割り当てられる（警告が増えない）。
        await expect(pending).resolves.toBe('Tuner request failed with status 503');
        const after = makeReserve({ id: 23, programId: 23, channel: 'ch-c', endAt: Date.now() + 120_000 });
        closeStreamLater(await creator.create(after));
        expect(occupancyWarnings(log)).toBe(1);
    }, 30_000);

    it('[RE-REAL-OCCUPANCY] keeps the tuner occupied after the first stream opens, and frees it when that stream ends', async () => {
        const { creator, log, server } = await createFixture(1);
        const first = makeReserve({ id: 31, programId: 31, channel: 'ch-a', endAt: Date.now() + 120_000 });
        // 録画は stream を読み続けるので、終わりは読む側に届く。
        (await creator.create(first)).resume();
        const second = makeReserve({ id: 32, programId: 32, channel: 'ch-b', endAt: Date.now() + 120_000 });
        closeStreamLater(await creator.create(second));
        expect(occupancyWarnings(log)).toBe(1);

        (await server.response(31)).end();
        await vi.waitFor(() => expect(server.closedAt.has('program:31')).toBe(true));
        await new Promise(resolve => setTimeout(resolve, 100));
        const third = makeReserve({ id: 33, programId: 33, channel: 'ch-c', endAt: Date.now() + 120_000 });
        closeStreamLater(await creator.create(third));
        expect(occupancyWarnings(log)).toBe(1);
    }, 30_000);
});

describe('changing the end time of a time-specified recording whose stream is open on a real tuner server', () => {
    const openTimeSpecified = async (
        creator: any,
        server: SyntheticTunerServer,
        id: number,
        endsInMs: number,
    ): Promise<{ closedAfter: () => number | undefined; reservation: any; startedAt: number }> => {
        const startedAt = Date.now();
        const reservation = makeReserve({
            id,
            programId: null,
            isTimeSpecified: true,
            channel: `ch-${id}`,
            channelId: id,
            startAt: startedAt - 1_000,
            endAt: startedAt + endsInMs,
        });
        closeStreamLater(await creator.create(reservation));
        await vi.waitFor(() => expect(server.streamRequests('service', id)).toHaveLength(1));
        return {
            closedAfter: () => {
                const closed = server.closedAt.get(`service:${id}`);
                return closed === undefined ? undefined : closed - startedAt;
            },
            reservation,
            startedAt,
        };
    };

    it('[RE-REAL-CHANGE-END-AT] stops the stream at the extended end time and not at the original end time', async () => {
        const { creator, server } = await createFixture(1);
        const opened = await openTimeSpecified(creator, server, 41, 1_500);
        creator.changeEndAt(Object.assign(opened.reservation, { endAt: opened.startedAt + 3_500 }));

        await new Promise(resolve => setTimeout(resolve, 2_200));
        expect(opened.closedAfter()).toBeUndefined();
        await vi.waitFor(() => expect(opened.closedAfter()).toBeDefined(), { timeout: 4_000, interval: 20 });
        expect(opened.closedAfter()).toBeGreaterThanOrEqual(3_400);
        expect(opened.closedAfter()).toBeLessThan(7_000);
    }, 30_000);

    it('[RE-REAL-CHANGE-END-AT] stops the stream at the shortened end time', async () => {
        const { creator, server } = await createFixture(1);
        const opened = await openTimeSpecified(creator, server, 42, 8_000);
        creator.changeEndAt(Object.assign(opened.reservation, { endAt: opened.startedAt + 1_200 }));

        await vi.waitFor(() => expect(opened.closedAfter()).toBeDefined(), { timeout: 4_000, interval: 20 });
        expect(opened.closedAfter()).toBeGreaterThanOrEqual(1_100);
        expect(opened.closedAfter()).toBeLessThan(5_000);
    }, 30_000);
});

describe('releasing the tuner of recordings that are about to end, against a real tuner server', () => {
    const primeEndingRecording = async (
        creator: any,
        server: SyntheticTunerServer,
        overrides: Record<string, unknown>,
        programEndsInMs: number | 'error',
    ) => {
        const ending = makeReserve({
            id: 51,
            programId: 51,
            channel: 'ch-ending',
            allowEndLack: true,
            endAt: Date.now() + 10_000,
            ...overrides,
        });
        server.programs.set(51, programEndsInMs === 'error' ? 'error' : tunerProgram(51, programEndsInMs));
        closeStreamLater(await creator.create(ending));
        await vi.waitFor(() => expect(server.streamRequests('program', 51)).toHaveLength(1));
        const next = makeReserve({ id: 52, programId: 52, channel: 'ch-next', endAt: Date.now() + 120_000 });
        closeStreamLater(await creator.create(next));
        expect(server.streamRequests('program', 52)).toHaveLength(1);
    };

    it('[RE-REAL-REASSIGN] cuts the ending recording stream and gives the tuner to the new recording when no extension is found', async () => {
        const { creator, server } = await createFixture(1);
        await primeEndingRecording(creator, server, {}, 10_000);

        expect(server.requests.some(request => request.url === '/api/programs/51')).toBe(true);
        await vi.waitFor(() => expect(server.closedAt.has('program:51')).toBe(true));
    }, 30_000);

    it('[RE-REAL-REASSIGN] keeps the ending recording stream when the latest program information shows an extension', async () => {
        const { creator, server } = await createFixture(1);
        await primeEndingRecording(creator, server, {}, 600_000);

        await new Promise(resolve => setTimeout(resolve, 300));
        expect(server.closedAt.has('program:51')).toBe(false);
    }, 30_000);

    it('[RE-REAL-REASSIGN] keeps the ending recording stream when its reservation does not allow ending early', async () => {
        const { creator, server } = await createFixture(1);
        await primeEndingRecording(creator, server, { allowEndLack: false }, 10_000);

        await new Promise(resolve => setTimeout(resolve, 300));
        expect(server.closedAt.has('program:51')).toBe(false);
        expect(server.requests.some(request => request.url === '/api/programs/51')).toBe(false);
    }, 30_000);

    it('[RE-REAL-REASSIGN-LOOKUP-FAILURE] logs the failure and still cuts the ending recording stream when the program lookup answers 500', async () => {
        const { creator, log, server } = await createFixture(1);
        await primeEndingRecording(creator, server, {}, 'error');

        await vi.waitFor(() => expect(server.closedAt.has('program:51')).toBe(true));
        expect(log.system.warn).toHaveBeenCalledWith('tuner program get error: 51');
    }, 30_000);
});

describe('stream requests of a time-specified reservation that has already ended, against a real tuner server', () => {
    it('[RE-REAL-ENDED-TIME-SPECIFIED] fails without sending any stream request', async () => {
        const { creator, server } = await createFixture(1);
        const ended = makeReserve({
            id: 61,
            programId: null,
            isTimeSpecified: true,
            channelId: 61,
            startAt: Date.now() - 60_000,
            endAt: Date.now() - 1,
        });

        await expect(creator.create(ended)).rejects.toThrow('TimeSpecifiedStreamTimeoutError');
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(server.requests).toEqual([]);
    }, 30_000);
});

describe('failures of the stream request, as the recording stream creator returns them', () => {
    it('[RE-REAL-OPEN-FAILURE] rejects with the tuner access failure when the tuner server answers 503, and when it drops the connection', async () => {
        const { creator, server } = await createFixture(2);
        server.behave('program', 71, { kind: 'status', status: 503 });
        server.behave('program', 72, { kind: 'drop' });

        await expect(creator.create(makeReserve({ id: 71, programId: 71, channel: 'a' }))).rejects.toThrow(
            'Tuner request failed with status 503',
        );
        await expect(creator.create(makeReserve({ id: 72, programId: 72, channel: 'b' }))).rejects.toThrow(
            'Tuner request failed',
        );
        expect(server.streamRequests('program', 71)).toHaveLength(1);
        expect(server.streamRequests('program', 72)).toHaveLength(1);
    }, 30_000);
});
