import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createEpgFixture,
    mirakcEvent,
    mirakurunFrame,
    rawProgramOf,
    rawServiceOf,
    until,
    writeFeed,
    type EpgFixture,
    type Product,
} from './_real-epg-tuner';

/*
 * 番組情報の更新を、実 HTTP の tuner server（REST の応答と変更通知の feed）・本物の `TunerServerAccessModel`・
 * `EPGUpdateManageModel`・`EPGUpdater`・実 SQLite の `ChannelDB`・`ProgramDB` でつないで確かめる。
 * 10 秒周期・10 分・30 秒の時間だけ時計の部品（vitest の fake timer と偽の `Date`）で進め、通信・DB・子の流れは実物のまま。
 * 書き込みの遅れは、本物の `ProgramDB` の前に置いた門（呼び出しを待たせるだけ）で作る（SQLite は同期の driver で、
 * 別接続のロックで書き込みだけを止める手段が無いため）。
 */

const NOW = Date.UTC(2030, 0, 1);
const TICK = 10_000;
const realSetTimeout = setTimeout;
const realSleep = (ms: number): Promise<void> => new Promise(resolve => realSetTimeout(resolve, ms));

const serviceA = rawServiceOf(1001, 101);
const serviceB = rawServiceOf(1002, 102);
const serviceC = rawServiceOf(1003, 103);

const fixtures: EpgFixture[] = [];
let clockInstalled = false;

const startFakeClock = (): void => {
    vi.useFakeTimers({
        now: NOW,
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    clockInstalled = true;
};

const make = async (product: Product, fakeClock = true): Promise<EpgFixture> => {
    const fixture = await createEpgFixture(product, { now: () => Date.now() });
    fixtures.push(fixture);
    if (fakeClock) startFakeClock();
    return fixture;
};

afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
        // 変更通知の接続を切ると、更新処理は再接続の待ち（fake timer の中）へ入る。そこで止めてから実時計へ戻す。
        await fixture.server.close();
        if (clockInstalled) {
            await realSleep(50);
            await vi.advanceTimersByTimeAsync(0);
        }
        await fixture.persistence.cleanup();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    clockInstalled = false;
});

const tick = async (count = 1): Promise<void> => {
    for (let index = 0; index < count; index += 1) await vi.advanceTimersByTimeAsync(TICK);
};

const errorCount = (fixture: EpgFixture, text: string): number =>
    fixture.logger.system.error.mock.calls.filter(([message]) => message === text).length;

/** 更新の開始を待ち、最初の全件同期（放送局・番組）を終えた状態にする。 */
const startAndSync = async (fixture: EpgFixture): Promise<void> => {
    void fixture.updater.start();
    await until(() => fixture.sent.length === 1);
};

describe('program guide with a real HTTP tuner server and real SQLite', () => {
    it('[PG-7.8][PG-7.9][PG-7.10][PG-7.14] keeps one full synchronization across ten minutes of ticks, only logs the deadline, applies the late result once, and re-evaluates once', async () => {
        const fixture = await make('mirakurun');
        const programA = rawProgramOf(5001, 101, NOW + 60_000);
        const programB = rawProgramOf(5002, 102, NOW + 60_000);
        fixture.server.services = [serviceA, serviceB];
        fixture.server.programs = [programA, programB];
        const releaseInsert = fixture.gates.insert.hold();
        const saveOnAir = vi.spyOn(fixture.manager, 'saveOnAirServices');

        void fixture.updater.start();
        await until(() => fixture.gates.insert.calls === 1);
        expect(fixture.server.count('/api/services')).toBe(1);
        expect(fixture.server.count('/api/programs')).toBe(1);
        // 同期の最中に届いた番組の変更。同期が終わったあとの再評価で反映される
        const feed = await fixture.server.feed();
        await writeFeed(
            feed,
            mirakurunFrame('update', rawProgramOf(5001, 101, NOW + 60_000, 'synthetic-renamed'), NOW),
        );
        await until(() => fixture.server.count('/api/events/stream') === 1);

        await tick(59);
        expect(errorCount(fixture, 'update all timeout')).toBe(0);
        await tick(1);
        expect(errorCount(fixture, 'update all timeout')).toBe(1);
        await tick(5);

        // 10 分を過ぎても取り消さず、新しい周期処理は始めず、書き込みは重ならない
        expect(errorCount(fixture, 'update all timeout')).toBe(1);
        expect(errorCount(fixture, 'EPG update error')).toBe(0);
        expect(fixture.gates.insert.calls).toBe(1);
        expect(fixture.gates.insert.peak).toBe(1);
        expect(fixture.server.count('/api/programs')).toBe(1);
        expect(fixture.server.count('/api/services')).toBe(1);
        expect(saveOnAir).not.toHaveBeenCalled();
        expect(await fixture.programRows()).toEqual([]);

        releaseInsert();
        await until(async () => (await fixture.programRows()).some(row => row.name === 'synthetic-renamed'));
        await until(() => saveOnAir.mock.calls.length === 1);
        expect((await fixture.programRows()).map(row => row.id)).toEqual([5001, 5002]);

        // 遅れて確定した結果は 1 回だけ反映され、保留していた再評価は 1 回だけ行われる（60 回分は行われない）
        await vi.advanceTimersByTimeAsync(0);
        await realSleep(100);
        expect(fixture.gates.insert.calls).toBe(1);
        expect(fixture.gates.update.calls).toBe(1);
        expect(saveOnAir).toHaveBeenCalledTimes(1);
        expect(errorCount(fixture, 'update all timeout')).toBe(1);

        // 以後は次の周期から通常どおり進む
        await tick(1);
        await until(() => saveOnAir.mock.calls.length === 2);
    }, 30_000);

    it('[PG-7.15] keeps one periodic database write across ten minutes without its own deadline and re-evaluates once after it settles', async () => {
        const fixture = await make('mirakurun');
        fixture.server.services = [serviceA, serviceB];
        fixture.server.programs = [rawProgramOf(5001, 101, NOW + 60_000), rawProgramOf(5002, 102, NOW + 60_000)];
        const saveOnAir = vi.spyOn(fixture.manager, 'saveOnAirServices');
        await startAndSync(fixture);
        expect((await fixture.programRows()).map(row => row.name)).toEqual([
            'synthetic-program-5001',
            'synthetic-program-5002',
        ]);

        const releaseUpdate = fixture.gates.update.hold();
        const feed = await fixture.server.feed();
        await writeFeed(
            feed,
            mirakurunFrame('update', rawProgramOf(5001, 101, NOW + 60_000, 'synthetic-renamed'), NOW),
        );
        await realSleep(50);
        await tick(1);
        await until(() => fixture.gates.update.calls === 1);
        expect(saveOnAir).toHaveBeenCalledTimes(1);

        await tick(61);
        expect(fixture.gates.update.calls).toBe(1);
        expect(fixture.gates.update.peak).toBe(1);
        expect(saveOnAir).toHaveBeenCalledTimes(1);
        expect(errorCount(fixture, 'EPG update error')).toBe(0);
        expect((await fixture.programRows()).map(row => row.name)).toEqual([
            'synthetic-program-5001',
            'synthetic-program-5002',
        ]);

        releaseUpdate();
        await until(async () => (await fixture.programRows()).some(row => row.name === 'synthetic-renamed'));
        await until(() => saveOnAir.mock.calls.length === 2);
        await vi.advanceTimersByTimeAsync(0);
        await realSleep(100);
        expect(fixture.gates.update.calls).toBe(1);
        expect(saveOnAir).toHaveBeenCalledTimes(2);

        await tick(1);
        await until(() => saveOnAir.mock.calls.length === 3);
    }, 30_000);

    it('[PG-7.11] takes the whole set of service IDs as one unit: requests them one after another and replaces their rows in one write', async () => {
        const fixture = await make('mirakc');
        fixture.server.services = [serviceA, serviceB, serviceC];
        fixture.server.programs = [
            rawProgramOf(5001, 101, NOW + 60_000),
            rawProgramOf(5002, 102, NOW + 60_000),
            rawProgramOf(5003, 103, NOW + 60_000),
        ];
        await startAndSync(fixture);
        expect((await fixture.programRows()).map(row => row.id)).toEqual([5001, 5002, 5003]);
        const insertCallsBefore = fixture.gates.insert.calls;

        fixture.server.programsByService.set(1001, [rawProgramOf(9001, 101, NOW + 60_000, 'synthetic-new-a')]);
        fixture.server.programsByService.set(1002, [rawProgramOf(9002, 102, NOW + 60_000, 'synthetic-new-b')]);
        const releaseFirst = fixture.server.hold('/api/services/1001/programs');
        const feed = await fixture.server.feed();
        await writeFeed(feed, mirakcEvent('onair.program-changed', 1001) + mirakcEvent('onair.program-changed', 1002));
        await realSleep(50);
        await tick(1);
        await until(() => fixture.server.count('/api/services/1001/programs') === 1);
        await realSleep(100);

        // 1 件目の応答を待っている間は、2 件目を要求せず、書き込みも始めない
        expect(fixture.server.count('/api/services/1002/programs')).toBe(0);
        expect(fixture.gates.insert.calls).toBe(insertCallsBefore);
        releaseFirst();
        await until(() => fixture.gates.insert.calls === insertCallsBefore + 1);

        const requested = fixture.server.requests
            .map(request => request.url)
            .filter(url => /\/programs$/u.test(url) && url !== '/api/programs');
        expect(requested).toEqual(['/api/services/1001/programs', '/api/services/1002/programs']);
        const [, programs, serviceIds] = fixture.gates.insert.args[insertCallsBefore];
        expect((programs as Array<{ id: number }>).map(program => program.id)).toEqual([9001, 9002]);
        expect(serviceIds).toEqual([1001, 1002]);
        await until(async () => (await fixture.programRows()).length === 3);
        expect(await fixture.programRows()).toEqual([
            { channelId: 1003, id: 5003, name: 'synthetic-program-5003' },
            { channelId: 1001, id: 9001, name: 'synthetic-new-a' },
            { channelId: 1002, id: 9002, name: 'synthetic-new-b' },
        ]);
    }, 30_000);

    it('[PG-7.12] accepts a service programs response that arrives 29.999 seconds after the request', async () => {
        const fixture = await make('mirakc');
        fixture.server.services = [serviceA];
        fixture.server.programs = [rawProgramOf(5001, 101, NOW + 60_000)];
        await startAndSync(fixture);
        fixture.server.programsByService.set(1001, [rawProgramOf(9001, 101, NOW + 60_000, 'synthetic-new-a')]);
        const release = fixture.server.hold('/api/services/1001/programs');
        await writeFeed(await fixture.server.feed(), mirakcEvent('onair.program-changed', 1001));
        await realSleep(50);
        await tick(1);
        await until(() => fixture.server.count('/api/services/1001/programs') === 1);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(fixture.server.abandoned).toEqual([]);
        expect(errorCount(fixture, 'EPG update error')).toBe(0);
        release();
        await until(async () => (await fixture.programRows()).some(row => row.name === 'synthetic-new-a'));
        expect(errorCount(fixture, 'EPG update error')).toBe(0);
    }, 30_000);

    it('[PG-7.12] gives up on a service programs request at 30 seconds, keeps the stored rows, and requests it again on the next cycle', async () => {
        const fixture = await make('mirakc');
        fixture.server.services = [serviceA];
        fixture.server.programs = [rawProgramOf(5001, 101, NOW + 60_000)];
        await startAndSync(fixture);
        fixture.server.programsByService.set(1001, [rawProgramOf(9001, 101, NOW + 60_000, 'synthetic-new-a')]);
        const release = fixture.server.hold('/api/services/1001/programs');
        await writeFeed(await fixture.server.feed(), mirakcEvent('onair.program-changed', 1001));
        await realSleep(50);
        await tick(1);
        await until(() => fixture.server.count('/api/services/1001/programs') === 1);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(fixture.server.abandoned).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await until(() => fixture.server.abandoned.includes('/api/services/1001/programs'));
        await until(() => errorCount(fixture, 'EPG update error') === 1);
        expect(fixture.gates.insert.calls).toBe(1);
        expect((await fixture.programRows()).map(row => row.id)).toEqual([5001]);
        release();

        // 失敗した service は未完了のまま残り、次の周期で取り直す
        await tick(1);
        await until(() => fixture.server.count('/api/services/1001/programs') === 2);
        await until(() => fixture.gates.insert.calls === 2);
        await until(async () => (await fixture.programRows()).some(row => row.name === 'synthetic-new-a'));
    }, 30_000);

    it('[PG-7.13] leaves the whole set unfinished when one request fails, keeps the notification already sent, and requests all three again on the next cycle', async () => {
        const fixture = await make('mirakc');
        fixture.server.services = [serviceA, serviceB, serviceC];
        fixture.server.programs = [
            rawProgramOf(5001, 101, NOW + 60_000),
            rawProgramOf(5002, 102, NOW + 60_000),
            rawProgramOf(5003, 103, NOW + 60_000),
        ];
        await startAndSync(fixture);
        const sentBefore = fixture.sent.length;
        const rowsBefore = await fixture.programRows();
        const insertCallsBefore = fixture.gates.insert.calls;
        for (const [id, serviceId] of [
            [1001, 101],
            [1002, 102],
            [1003, 103],
        ] as const) {
            fixture.server.programsByService.set(id, [
                rawProgramOf(id + 8000, serviceId, NOW + 60_000, `synthetic-new-${id}`),
            ]);
        }
        fixture.server.failures.set('/api/services/1002/programs', 500);

        // mirakc の最初の番組表の更新通知は、直後の通知を数えないための印として読み飛ばされる
        const feed = await fixture.server.feed();
        await writeFeed(feed, mirakcEvent('epg.programs-updated', 1001));
        await realSleep(50);
        await vi.advanceTimersByTimeAsync(1_001);
        await writeFeed(feed, [1001, 1002, 1003].map(id => mirakcEvent('epg.programs-updated', id)).join(''));
        await realSleep(50);

        await tick(6);
        await until(() => errorCount(fixture, 'failed to save update services') === 1);
        const requested = (id: number) => fixture.server.count(`/api/services/${id}/programs`);
        expect([requested(1001), requested(1002), requested(1003)]).toEqual([1, 1, 0]);
        expect(fixture.gates.insert.calls).toBe(insertCallsBefore);
        expect(await fixture.programRows()).toEqual(rowsBefore);
        // 周期の更新通知は、集合の保存が失敗しても取り消されない（送った通知がそのまま残る）
        expect(fixture.sent.length).toBe(sentBefore + 1);
        expect(fixture.sent.at(-1)).toEqual({ msg: 'updated' });

        fixture.server.failures.delete('/api/services/1002/programs');
        await tick(6);
        await until(() => fixture.gates.insert.calls === insertCallsBefore + 1);
        expect([requested(1001), requested(1002), requested(1003)]).toEqual([2, 2, 1]);
        expect(fixture.gates.insert.args[insertCallsBefore][2]).toEqual([1001, 1002, 1003]);
        await until(async () => {
            const rows = await fixture.programRows();
            return rows.length === 3 && rows.every(row => row.name.startsWith('synthetic-new-'));
        });
        expect((await fixture.programRows()).map(row => row.id)).toEqual([9001, 9002, 9003]);
    }, 40_000);
});

describe('program guide change feeds delivered over a real TCP connection', () => {
    it.each([
        ['one byte at a time, including the bytes of a multibyte character', 'byte'],
        ['several frames in one write', 'whole'],
    ] as const)(
        '[DBL-042] reads Mirakurun frames delivered %s into the stored programs',
        async (_label, mode) => {
            const fixture = await make('mirakurun', false);
            fixture.server.services = [serviceA, serviceB];
            await fixture.manager.updateChannels();
            const completion = fixture.manager.start().catch(() => undefined);
            const feed = await fixture.server.feed();
            const first = mirakurunFrame('create', rawProgramOf(5001, 101, 1_000, 'synthetic-first'), 1_000);
            const second = mirakurunFrame('update', rawProgramOf(5002, 102, 2_000, 'synthetic-番組-second'), 2_000);
            const third = mirakurunFrame('create', rawProgramOf(5003, 101, 3_000, 'synthetic-{brace}-"third"'), 3_000);
            await writeFeed(feed, first + second, 'whole');
            await writeFeed(feed, third, mode);

            await until(async () => {
                await fixture.manager.saveProgram();
                return (await fixture.programRows()).length === 3;
            });
            expect(await fixture.programRows()).toEqual([
                { channelId: 1001, id: 5001, name: 'synthetic-first' },
                { channelId: 1002, id: 5002, name: 'synthetic-番組-second' },
                { channelId: 1001, id: 5003, name: 'synthetic-{brace}-"third"' },
            ]);
            expect(fixture.logger.system.error).not.toHaveBeenCalled();
            await fixture.server.close();
            await completion;
        },
        30_000,
    );

    it.each([
        ['one byte at a time', 'byte'],
        ['several events in one write', 'whole'],
    ] as const)(
        '[DBL-042] reads mirakc events delivered %s and updates the stored programs of those services',
        async (_label, mode) => {
            const fixture = await make('mirakc', false);
            fixture.server.services = [serviceA, serviceB, serviceC];
            for (const [id, serviceId] of [
                [1001, 101],
                [1002, 102],
                [1003, 103],
            ] as const) {
                fixture.server.programsByService.set(id, [
                    rawProgramOf(id + 4000, serviceId, 1_000, `synthetic-service-program-${id}`),
                ]);
            }
            await fixture.manager.updateChannels();
            const completion = fixture.manager.start().catch(() => undefined);
            const feed = await fixture.server.feed();
            await writeFeed(
                feed,
                mirakcEvent('onair.program-changed', 1001) + mirakcEvent('onair.program-changed', 1002),
                'whole',
            );
            await writeFeed(feed, mirakcEvent('onair.program-changed', 1003), mode);

            await until(async () => {
                await fixture.manager.saveOnAirServices();
                return (await fixture.programRows()).length === 3;
            });
            expect(await fixture.programRows()).toEqual([
                { channelId: 1001, id: 5001, name: 'synthetic-service-program-1001' },
                { channelId: 1002, id: 5002, name: 'synthetic-service-program-1002' },
                { channelId: 1003, id: 5003, name: 'synthetic-service-program-1003' },
            ]);
            expect(fixture.logger.system.error).not.toHaveBeenCalled();
            await fixture.server.close();
            await completion;
        },
        30_000,
    );
});
