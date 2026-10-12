import { describe, expect, it, vi } from 'vitest';
import { makeReserve, Reserve, ReserveApiModel, ReserveDB } from './_harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

const makeRuleCountProvider = (rows: readonly Record<string, unknown>[] = [], repositoryError?: Error) => {
    const queryBuilder: Record<string, any> = {};
    queryBuilder.select = vi.fn(() => queryBuilder);
    queryBuilder.where = vi.fn(() => queryBuilder);
    queryBuilder.groupBy = vi.fn(() => queryBuilder);
    queryBuilder.getRawMany = vi.fn(async () => {
        if (repositoryError !== undefined) throw repositoryError;
        return rows;
    });
    const createQueryBuilder = vi.fn(() => queryBuilder);
    const getConnection = vi.fn(async () => ({
        getRepository: vi.fn(() => ({ createQueryBuilder })),
    }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };

    return {
        provider: new ReserveDB(silentLoggerModel, { getConnection }, retry),
        getConnection,
        queryBuilder,
        retry,
    };
};

/** Fluent connection.createQueryBuilder mock for ReserveDB id-select query bodies. */
const makeIdSelectProvider = (rows: readonly { id: number }[] = [], repositoryError?: Error) => {
    const queryBuilder: Record<string, any> = {};
    for (const method of ['select', 'from', 'where', 'andWhere', 'orderBy'] as const) {
        queryBuilder[method] = vi.fn(() => queryBuilder);
    }
    queryBuilder.getMany = vi.fn(async () => {
        if (repositoryError !== undefined) throw repositoryError;
        return rows;
    });
    const createQueryBuilder = vi.fn(() => queryBuilder);
    const convertBoolean = vi.fn((value: boolean) => value);
    const getConnection = vi.fn(async () => ({ createQueryBuilder }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };

    return {
        provider: new ReserveDB(silentLoggerModel, { getConnection, convertBoolean }, retry),
        getConnection,
        createQueryBuilder,
        queryBuilder,
        convertBoolean,
        retry,
    };
};

describe('reservation query characterization', () => {
    it('[RM-7.3] preserves repository ordering, total, and query options', async () => {
        const rows = [makeReserve({ id: 2, startAt: 20 }), makeReserve({ id: 1, startAt: 10 })];
        const findAll = vi.fn(async () => [rows, 9]);
        const api = new ReserveApiModel({}, { findAll });
        const option = { type: 'normal', ruleId: 4, offset: 2, limit: 2, isHalfWidth: false };
        const result = await api.gets(option);
        expect(findAll).toHaveBeenCalledWith(option);
        expect(result.total).toBe(9);
        expect(result.reserves.map((row: any) => row.id)).toEqual([2, 1]);
    });

    it('returns null or the legacy optional projection', async () => {
        const findId = vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(
                makeReserve({ ruleId: 8, programId: 9, tags: '["tag"]', encodeDirectory2: 'hidden' }),
            );
        const api = new ReserveApiModel({}, { findId });
        await expect(api.get(404, false)).resolves.toBeNull();
        const item = await api.get(1, false);
        expect(item).toMatchObject({ ruleId: 8, programId: 9, tags: ['tag'] });
        expect(item).not.toHaveProperty('encodeDirectory2');
    });

    it('returns an empty readonly count collection without querying for an empty rule page', async () => {
        const fixture = makeRuleCountProvider();

        await expect(fixture.provider.countByRuleIds([], 'all')).resolves.toEqual([]);
        expect(fixture.getConnection).not.toHaveBeenCalled();
        expect(fixture.retry.run).not.toHaveBeenCalled();
    });

    it('[RM-7.6] preserves unordered partial repository results and exposes the provider value shape', async () => {
        const fixture = makeRuleCountProvider([
            { ruleId: 9, ruleIdCnt: '2' },
            { ruleId: 3, ruleIdCnt: 1 },
        ]);

        await expect(fixture.provider.countByRuleIds([3, 6, 9], 'all')).resolves.toEqual([
            { ruleId: 9, count: 2 },
            { ruleId: 3, count: 1 },
        ]);
    });

    it.each([
        ['all', {}],
        ['normal', { isConflict: false, isSkip: false, isOverlap: false }],
        ['conflict', { isConflict: true, isSkip: false, isOverlap: false }],
        ['skip', { isConflict: false, isSkip: true, isOverlap: false }],
        ['overlap', { isConflict: false, isSkip: false, isOverlap: true }],
    ] as const)('applies the exact %s state predicate', async (state, expectedFlags) => {
        const fixture = makeRuleCountProvider();

        await fixture.provider.countByRuleIds([4, 2], state);

        const where = fixture.queryBuilder.where.mock.calls[0][0] as Record<string, any>;
        const { ruleId, ...actualFlags } = where;
        expect(ruleId.type).toBe('in');
        expect(ruleId.value).toEqual([4, 2]);
        expect(actualFlags).toEqual(expectedFlags);
    });

    it('propagates the repository rejection through the existing persistence retry boundary', async () => {
        const repositoryError = new Error('count query failed');
        const fixture = makeRuleCountProvider([], repositoryError);

        await expect(fixture.provider.countByRuleIds([1], 'all')).rejects.toBe(repositoryError);
        expect(fixture.retry.run).toHaveBeenCalledTimes(1);
    });

    it('[RM-7.1] sends every supported state list filter to the reservation repository', async () => {
        const findAll = vi.fn(async () => [[], 0]);
        const api = new ReserveApiModel({}, { findAll });

        for (const type of ['all', 'normal', 'conflict', 'skip', 'overlap']) {
            await api.gets({ type, offset: 0, limit: 10, isHalfWidth: false });
        }

        expect(findAll.mock.calls.map(call => call[0].type)).toEqual(['all', 'normal', 'conflict', 'skip', 'overlap']);
    });

    it('[RM-7.2] combines a rule identifier and state filter in one list query', async () => {
        const findAll = vi.fn(async () => [[], 0]);
        const api = new ReserveApiModel({}, { findAll });

        await api.gets({ type: 'conflict', ruleId: 18, offset: 0, limit: 10, isHalfWidth: false });
        expect(findAll).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'conflict', ruleId: 18, offset: 0, limit: 10 }),
        );
    });

    it('[RM-7.4] projects the stored reservation details through the existing public shape', async () => {
        const findId = vi.fn(async () =>
            makeReserve({
                id: 7,
                isSkip: true,
                isConflict: true,
                isOverlap: true,
                allowEndLack: true,
                isTimeSpecified: true,
                isDeleteOriginalAfterEncode: true,
                channelId: 17,
                channelType: 'GR',
                startAt: 1_000,
                endAt: 2_000,
                name: 'name',
                ruleId: 8,
                programId: 9,
                tags: '["tag"]',
                parentDirectoryName: 'parent',
                directory: 'directory',
                recordedFormat: 'format',
                encodeMode1: 'mode-1',
                encodeParentDirectoryName1: 'encode-parent-1',
                encodeDirectory1: 'encode-directory-1',
                encodeMode2: 'mode-2',
                encodeParentDirectoryName2: 'encode-parent-2',
                encodeDirectory2: 'hidden-2',
                encodeMode3: 'mode-3',
                encodeParentDirectoryName3: 'encode-parent-3',
                encodeDirectory3: 'encode-directory-3',
            }),
        );
        const api = new ReserveApiModel({}, { findId });

        await expect(api.get(7, false)).resolves.toEqual({
            id: 7,
            isSkip: true,
            isConflict: true,
            isOverlap: true,
            allowEndLack: true,
            isTimeSpecified: true,
            isDeleteOriginalAfterEncode: true,
            channelId: 17,
            channelType: 'GR',
            startAt: 1_000,
            endAt: 2_000,
            name: 'name',
            ruleId: 8,
            programId: 9,
            tags: ['tag'],
            parentDirectoryName: 'parent',
            directory: 'directory',
            recordedFormat: 'format',
            encodeMode1: 'mode-1',
            encodeParentDirectoryName1: 'encode-parent-1',
            encodeDirectory1: 'encode-directory-1',
            encodeMode2: 'mode-2',
            encodeParentDirectoryName2: 'encode-parent-2',
            encodeMode3: 'mode-3',
            encodeParentDirectoryName3: 'encode-parent-3',
            encodeDirectory3: 'encode-directory-3',
        });
    });

    it('[RM-7.5] omits the legacy second encode directory from the public projection', async () => {
        const api = new ReserveApiModel({}, { findId: vi.fn(async () => makeReserve({ encodeDirectory2: 'hidden' })) });

        await expect(api.get(1, false)).resolves.not.toHaveProperty('encodeDirectory2');
    });

    it('[RM-7.7] returns null for a missing reservation detail', async () => {
        const api = new ReserveApiModel({}, { findId: vi.fn(async () => null) });

        await expect(api.get(404, false)).resolves.toBeNull();
    });

    it('projects optional program metadata for full-width and half-width detail reads', async () => {
        // RED baseline: makeReserve leaves description/extended/genres/video null → projection omits them.
        // GREEN: non-null optional metadata exercises toReserveItem L132–191 for both isHalfWidth values.
        const reserve = makeReserve({
            id: 11,
            description: 'full-description',
            halfWidthDescription: 'half-description',
            extended: 'full-extended',
            halfWidthExtended: 'half-extended',
            rawExtended: '{"key":"full"}',
            rawHalfWidthExtended: '{"key":"half"}',
            genre1: 1,
            subGenre1: 11,
            genre2: 2,
            subGenre2: 12,
            genre3: 3,
            subGenre3: 13,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 1,
            videoComponentType: 2,
            audioSamplingRate: 48_000,
        });
        const findId = vi.fn(async () => reserve);
        const api = new ReserveApiModel({}, { findId });

        await expect(api.get(11, false)).resolves.toMatchObject({
            id: 11,
            name: 'synthetic-name',
            description: 'full-description',
            extended: 'full-extended',
            rawExtended: { key: 'full' },
            genre1: 1,
            subGenre1: 11,
            genre2: 2,
            subGenre2: 12,
            genre3: 3,
            subGenre3: 13,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 1,
            videoComponentType: 2,
            audioSamplingRate: 48_000,
        });
        await expect(api.get(11, true)).resolves.toMatchObject({
            id: 11,
            name: 'synthetic-half-name',
            description: 'half-description',
            extended: 'half-extended',
            rawExtended: { key: 'half' },
            genre1: 1,
            subGenre1: 11,
            genre2: 2,
            subGenre2: 12,
            genre3: 3,
            subGenre3: 13,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 1,
            videoComponentType: 2,
            audioSamplingRate: 48_000,
        });
        expect(findId).toHaveBeenCalledWith(11);
        expect(findId).toHaveBeenCalledTimes(2);
    });

    it('maps getManualIds for non-time reserves through ruleId-null and programId-not-null id select', async () => {
        const fixture = makeIdSelectProvider([{ id: 4 }, { id: 9 }]);

        await expect(fixture.provider.getManualIds({ hasTimeReserve: false })).resolves.toEqual([4, 9]);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.createQueryBuilder).toHaveBeenCalledOnce();
        expect(fixture.queryBuilder.select).toHaveBeenCalledWith('reserve.id');
        expect(fixture.queryBuilder.from).toHaveBeenCalledWith(Reserve, 'reserve');
        expect(fixture.queryBuilder.where).toHaveBeenCalledWith('reserve.ruleId is :ruleId', { ruleId: null });
        expect(fixture.queryBuilder.andWhere).toHaveBeenCalledWith('reserve.programId is not null');
        expect(fixture.queryBuilder.orderBy).toHaveBeenCalledWith('reserve.id', 'ASC');
        expect(fixture.retry.run).toHaveBeenCalledTimes(1);
        expect(fixture.queryBuilder.getMany).toHaveBeenCalledOnce();
        expect(fixture.convertBoolean).not.toHaveBeenCalled();
    });

    it('maps getManualIds for time reserves through ruleId-null without a programId predicate', async () => {
        const fixture = makeIdSelectProvider([{ id: 2 }, { id: 5 }]);

        await expect(fixture.provider.getManualIds({ hasTimeReserve: true })).resolves.toEqual([2, 5]);

        expect(fixture.queryBuilder.where).toHaveBeenCalledWith('reserve.ruleId is :ruleId', { ruleId: null });
        expect(fixture.queryBuilder.andWhere).not.toHaveBeenCalled();
        expect(fixture.queryBuilder.orderBy).toHaveBeenCalledWith('reserve.id', 'ASC');
        expect(fixture.retry.run).toHaveBeenCalledTimes(1);
        expect(fixture.queryBuilder.getMany).toHaveBeenCalledOnce();
    });

    it('maps getRuleEventRelayIds through ruleId-not-null and convertBoolean event-relay id select', async () => {
        const fixture = makeIdSelectProvider([{ id: 11 }, { id: 13 }]);

        await expect(fixture.provider.getRuleEventRelayIds()).resolves.toEqual([11, 13]);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.createQueryBuilder).toHaveBeenCalledOnce();
        expect(fixture.queryBuilder.select).toHaveBeenCalledWith('reserve.id');
        expect(fixture.queryBuilder.from).toHaveBeenCalledWith(Reserve, 'reserve');
        expect(fixture.queryBuilder.where).not.toHaveBeenCalled();
        expect(fixture.queryBuilder.andWhere).toHaveBeenNthCalledWith(1, 'reserve.ruleId is not null');
        expect(fixture.queryBuilder.andWhere).toHaveBeenNthCalledWith(2, 'reserve.isEventRelay is :isEventRelay', {
            isEventRelay: true,
        });
        expect(fixture.convertBoolean).toHaveBeenCalledWith(true);
        expect(fixture.queryBuilder.orderBy).toHaveBeenCalledWith('reserve.id', 'ASC');
        expect(fixture.retry.run).toHaveBeenCalledTimes(1);
        expect(fixture.queryBuilder.getMany).toHaveBeenCalledOnce();
    });
});
