import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deferred, Recorded, Reserve, logger, makeRecorded, makeReserve, RecordingUtilModel } from './_harness';

// design.md#6.7.1 の 17 token 一覧を実装 (RecordingUtilModel.formatFilePathString /
// StrUtil.replaceFileName) に対して固定する characterization test。
// 対象 startAt (UTC) は 2024-01-05T15:06:07Z = JST 2024-01-06 00:06:07 (土)。
const SYNTHETIC_START_AT_UTC = Date.UTC(2024, 0, 5, 15, 6, 7);

const makeModel = (channelDB: Record<string, any>, programDB: Record<string, any> = {}) =>
    new RecordingUtilModel(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                recorded: [{ name: 'synthetic-root', path: join(tmpdir(), 'epgstation-filename-format-synthetic') }],
                recordedFormat: 'synthetic',
                recordedFileExtension: '.ts',
            }),
        },
        { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
        channelDB,
        { findChannelIdAndTime: vi.fn(async () => null), ...programDB },
        {},
        {},
    );

const notFoundChannelDB = { findId: vi.fn(async () => null) };
const foundChannelDB = {
    findId: vi.fn(async () => ({
        name: 'found-channel-name',
        halfWidthName: 'found-half-width-channel',
        serviceId: 4321,
        channelType: 'BS',
        channel: 'found-physical-channel',
    })),
};

describe('recording file name format tokens (design.md#6.7.1)', () => {
    it('[design.md#6.7.1] converts every date/time token to JST with the documented zero-padding', async () => {
        const model = makeModel(notFoundChannelDB);
        const reserve = makeReserve({ startAt: SYNTHETIC_START_AT_UTC });

        const result = await model.formatFilePathString(
            '%YEAR%/%SHORTYEAR%/%MONTH%/%DAY%/%HOUR%/%MIN%/%SEC%/%DOW%',
            reserve,
        );

        expect(result).toBe('2024/24/01/06/00/06/07/土');
    });

    it('[design.md#6.7.1] replaces a repeated token at every occurrence (global replace)', async () => {
        const model = makeModel(notFoundChannelDB);
        const reserve = makeReserve({ startAt: SYNTHETIC_START_AT_UTC });

        const result = await model.formatFilePathString('%YEAR%-%YEAR%-%YEAR%', reserve);

        expect(result).toBe('2024-2024-2024');
    });

    it('[design.md#6.7.1] falls back %TYPE%/%CHID%/%CHNAME%/%HALF_WIDTH_CHNAME%/%CH%/%SID% when the channel is not found', async () => {
        const model = makeModel(notFoundChannelDB);
        const reserve = makeReserve({ channelId: 777, channelType: 'GR', channel: 'reserve-channel' });

        const result = await model.formatFilePathString(
            '%TYPE%/%CHID%/%CHNAME%/%HALF_WIDTH_CHNAME%/%CH%/%SID%',
            reserve,
        );

        // channelType と channel は Reserve 自身の値、CHNAME/HALF_WIDTH_CHNAME は channelId 文字列へ fallback、
        // SID は 'NULL' へ fallback する。
        expect(result).toBe('GR/777/777/777/reserve-channel/NULL');
    });

    it('[design.md#6.7.1] overrides %TYPE%/%CHNAME%/%HALF_WIDTH_CHNAME%/%CH%/%SID% from the channel DB when found', async () => {
        const model = makeModel(foundChannelDB);
        const reserve = makeReserve({ channelId: 777, channelType: 'GR', channel: 'reserve-channel' });

        const result = await model.formatFilePathString(
            '%TYPE%/%CHID%/%CHNAME%/%HALF_WIDTH_CHNAME%/%CH%/%SID%',
            reserve,
        );

        expect(result).toBe('BS/777/found-channel-name/found-half-width-channel/found-physical-channel/4321');
    });

    it('[design.md#6.7.1] resolves %ID% from the reservation id for a Reserve source', async () => {
        const model = makeModel(notFoundChannelDB);
        const reserve = makeReserve({ id: 99 });

        await expect(model.formatFilePathString('%ID%', reserve)).resolves.toBe('99');
    });

    it('[design.md#6.7.1] resolves %ID% from the linked reserveId for a Recorded source, and NULL when absent', async () => {
        const model = makeModel(notFoundChannelDB);

        await expect(model.formatFilePathString('%ID%', makeRecorded({ reserveId: 5 }))).resolves.toBe('5');
        await expect(model.formatFilePathString('%ID%', makeRecorded({ reserveId: null }))).resolves.toBe('NULL');
    });

    it('[design.md#6.7.1] uses the reservation name for %TITLE% when the reservation is not time-specified', async () => {
        const model = makeModel(notFoundChannelDB);
        const reserve = makeReserve({ isTimeSpecified: false, name: 'reserve-title' });

        await expect(model.formatFilePathString('%TITLE%', reserve)).resolves.toBe('reserve-title');
    });

    it('[design.md#6.7.1] re-searches the program guide for %TITLE% only when the reservation is time-specified', async () => {
        const found = makeModel(notFoundChannelDB, {
            findChannelIdAndTime: vi.fn(async () => ({ name: 'guide-title' })),
        });
        const reserveFound = makeReserve({ isTimeSpecified: true, name: 'reserve-title' });
        await expect(found.formatFilePathString('%TITLE%', reserveFound)).resolves.toBe('guide-title');

        const notFound = makeModel(notFoundChannelDB, { findChannelIdAndTime: vi.fn(async () => null) });
        const reserveNotFound = makeReserve({ isTimeSpecified: true, name: 'reserve-title' });
        await expect(notFound.formatFilePathString('%TITLE%', reserveNotFound)).resolves.toBe('番組名なし');
    });

    it('[design.md#6.7.1] resolves %HALF_WIDTH_TITLE% from halfWidthName without re-searching the program guide', async () => {
        const model = makeModel(notFoundChannelDB, {
            findChannelIdAndTime: vi.fn(async () => ({ name: 'guide-title' })),
        });
        // isTimeSpecified=true が %TITLE% を guide-title へ差し替える一方、
        // %HALF_WIDTH_TITLE% は常に src.halfWidthName のままである (design.md#6.7.1)。
        const reserve = makeReserve({ isTimeSpecified: true, name: 'reserve-title', halfWidthName: 'half-width-title' });

        const result = await model.formatFilePathString('%TITLE%/%HALF_WIDTH_TITLE%', reserve);

        expect(result).toBe('guide-title/half-width-title');
    });

    it('[design.md#6.7.1] resolves %HALF_WIDTH_TITLE% to NULL when halfWidthName is null', async () => {
        const model = makeModel(notFoundChannelDB);
        const recorded = makeRecorded({ halfWidthName: null });

        await expect(model.formatFilePathString('%HALF_WIDTH_TITLE%', recorded)).resolves.toBe('NULL');
    });

    it('[design.md#6.7.1] replaces forbidden filename characters with full-width equivalents (not deletion) but leaves the sub directory untouched', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-filename-format-'));
        try {
            const model = new RecordingUtilModel(
                { getLogger: () => logger },
                {
                    getConfig: () => ({
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFormat: '%TITLE%',
                        recordedFileExtension: '.ts',
                    }),
                },
                { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
                notFoundChannelDB,
                { findChannelIdAndTime: vi.fn(async () => null) },
                {},
                {},
            );
            const reserve = makeReserve({
                name: 'a:b*c?d"e<f>g|h.i/j\\k',
                directory: 'x:y*z',
            });

            const result = await model.getRecPath(reserve, false);

            expect(result.fileName).toBe('a：b＊c？d”e＜f＞g｜h．i／j￥k.ts');
            // sub directory の禁止文字は置換されない (既存挙動、v2 と同一)。
            expect(result.subDir).toBe('x:y*z');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    // 録画の経路 (RecordingCandidateRegistry.upsert / RecordingScheduleController) は予約を
    // Object.freeze({ ...reservation }) で写した plain object にして RecorderModel へ渡し、
    // RecorderModel はそれを RecordingUtilModel.getRecPath -> formatFilePathString へ渡す。
    const snapshotOf = (reserve: Record<string, any>) => Object.freeze({ ...reserve });

    it('[design.md#6.7.1] resolves %ID% from the reservation id for the plain snapshot the recording path passes', async () => {
        const model = makeModel(notFoundChannelDB);
        const snapshot = snapshotOf(makeReserve({ id: 99 }));
        expect(snapshot instanceof Reserve).toBe(false);

        await expect(model.formatFilePathString('%ID%', snapshot as any)).resolves.toBe('99');
    });

    it('[design.md#6.7.1] re-searches the program guide for %TITLE% of a time-specified reservation snapshot', async () => {
        const findChannelIdAndTime = vi.fn(async () => ({ name: 'guide-title' }));
        const model = makeModel(notFoundChannelDB, { findChannelIdAndTime });
        const reserve = makeReserve({ isTimeSpecified: true, name: 'reserve-title', channelId: 777 });
        const snapshot = snapshotOf(reserve);

        await expect(model.formatFilePathString('%TITLE%', snapshot as any)).resolves.toBe('guide-title');
        expect(findChannelIdAndTime).toHaveBeenCalledWith(777, reserve.startAt);
    });

    it('[design.md#6.7.1] uses the %ID% and the guide title of a time-specified reservation snapshot in the recording file name', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-filename-format-'));
        try {
            const model = new RecordingUtilModel(
                { getLogger: () => logger },
                {
                    getConfig: () => ({
                        recorded: [{ name: 'synthetic-root', path: root }],
                        recordedFormat: '%TITLE%',
                        recordedFileExtension: '.ts',
                    }),
                },
                { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
                notFoundChannelDB,
                { findChannelIdAndTime: vi.fn(async () => ({ name: 'guide-title' })) },
                {},
                {},
            );
            const snapshot = snapshotOf(
                makeReserve({
                    id: 99,
                    isTimeSpecified: true,
                    name: 'reserve-title',
                    recordedFormat: '%ID%-%TITLE%',
                    directory: 'dir-%ID%',
                }),
            );

            const result = await model.getRecPath(snapshot as any, false);

            expect(result.fileName).toBe('99-guide-title.ts');
            expect(result.subDir).toBe('dir-99');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('is exercised as a Recorded instance without triggering the Reserve-only time-specified branch', async () => {
        const model = makeModel(notFoundChannelDB);
        const recorded = makeRecorded({ name: 'recorded-title' });
        expect(recorded instanceof Recorded).toBe(true);

        await expect(model.formatFilePathString('%TITLE%', recorded)).resolves.toBe('recorded-title');
    });

    it('[design.md#6.7.1 gap] resolves %TITLE% to NULL when the source name itself is null', async () => {
        const model = makeModel(notFoundChannelDB);
        const reserve = makeReserve({ isTimeSpecified: false, name: null as unknown as string });

        await expect(model.formatFilePathString('%TITLE%', reserve)).resolves.toBe('NULL');
    });

    it('[design.md#6.7.1 gap] falls back %CHID% to NULL when channelId is cleared during the channel lookup', async () => {
        const lookup = deferred<null>();
        const model = makeModel({ findId: vi.fn(() => lookup.promise) });
        const reserve = makeReserve({ channelId: 777, isTimeSpecified: false });

        const formatting = model.formatFilePathString('%CHID%', reserve);
        (reserve as { channelId: number | null }).channelId = null;
        lookup.resolve(null);

        await expect(formatting).resolves.toBe('NULL');
    });
});
