import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProduction, makeProgram, makeReservationHarness, makeRule } from '../fixtures/reservation-rules/runtime';

// 先頭が区切りの指定は、保存先の絶対 path と見分けが付かないよう値を組み立てて渡す
const rooted = (relative: string): string => `/${relative}`;

type Candidate = Record<string, unknown>;

type RuleManager = {
    add(rule: Record<string, unknown>): Promise<number>;
    update(rule: Record<string, unknown> & { id: number }): Promise<void>;
};

const RuleManageModel = loadProduction<
    new (logger: unknown, checker: unknown, repository: unknown, event: unknown) => RuleManager
>('model', 'operator', 'rule', 'RuleManageModel.js');

// The current process-local seam is a flattened Reserve[]: updateTime is evaluatedAt,
// isTimeSpecified identifies kind, and isOverlap carries possibleDuplicate.
const installCandidateConsumer = (model: unknown) => {
    const consumer = vi.fn(
        async (_findOption: unknown, candidates: Candidate[], _oldCandidates: Candidate[], isSuppressLog: boolean) => ({
            isSuppressLog,
            insert: [],
            update: [],
            delete: [],
        }),
    );
    (model as { createDiff: typeof consumer }).createDiff = consumer;
    return consumer;
};

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('RuleCandidate recording option characterization', () => {
    it('[RR-4.2] hands off accepted encode modes, destinations, and original-file deletion', async () => {
        const evaluatedAt = 1_900_000_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(evaluatedAt);
        const rule = makeRule({
            id: 41,
            updateCnt: 9,
            reserveOption: {
                enable: true,
                allowEndLack: true,
                avoidDuplicate: false,
                tags: [7, 8],
            },
            saveOption: {
                parentDirectoryName: 'synthetic-parent',
                directory: 'synthetic/program',
                recordedFormat: 'synthetic-format',
            },
            encodeOption: {
                mode1: 'archive',
                encodeParentDirectoryName1: 'synthetic-encoded-parent-1',
                directory1: 'synthetic/archive',
                mode2: 'mobile',
                encodeParentDirectoryName2: 'synthetic-encoded-parent-2',
                directory2: 'synthetic/mobile',
                mode3: 'review',
                encodeParentDirectoryName3: 'synthetic-encoded-parent-3',
                directory3: 'synthetic/review',
                isDeleteOriginalAfterEncode: true,
            },
        });
        const program = makeProgram({
            id: 901,
            updateTime: 73,
            channelId: 404,
            channel: 'synthetic-404',
            channelType: 'BS',
            startAt: 1_900_000_010_000,
            endAt: 1_900_000_130_000,
            name: 'Synthetic Full Program',
            halfWidthName: 'Synthetic Full Program Half',
            shortName: 'Synthetic Short',
            description: 'synthetic description',
            halfWidthDescription: 'synthetic half description',
            extended: 'synthetic extended',
            halfWidthExtended: 'synthetic half extended',
            rawExtended: 'synthetic raw extended',
            rawHalfWidthExtended: 'synthetic raw half extended',
            genre1: 1,
            subGenre1: 2,
            genre2: 3,
            subGenre2: 4,
            genre3: 5,
            subGenre3: 6,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 7,
            videoComponentType: 8,
            audioSamplingRate: 48_000,
            audioComponentType: 9,
            overlap: true,
        });
        const harness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [program]) },
            ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn() },
        });
        const consumer = installCandidateConsumer(harness.model);

        await harness.model.updateRule(41);

        expect(consumer).toHaveBeenCalledTimes(1);
        const candidates = consumer.mock.calls[0][1];
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            ruleId: 41,
            ruleUpdateCnt: 9,
            updateTime: evaluatedAt,
            isTimeSpecified: false,
            programId: 901,
            programUpdateTime: 73,
            channelId: 404,
            channel: 'synthetic-404',
            channelType: 'BS',
            startAt: 1_900_000_010_000,
            endAt: 1_900_000_130_000,
            name: 'Synthetic Full Program',
            halfWidthName: 'Synthetic Full Program Half',
            shortName: 'Synthetic Short',
            description: 'synthetic description',
            halfWidthDescription: 'synthetic half description',
            extended: 'synthetic extended',
            halfWidthExtended: 'synthetic half extended',
            rawExtended: 'synthetic raw extended',
            rawHalfWidthExtended: 'synthetic raw half extended',
            genre1: 1,
            subGenre1: 2,
            genre2: 3,
            subGenre2: 4,
            genre3: 5,
            subGenre3: 6,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 7,
            videoComponentType: 8,
            audioSamplingRate: 48_000,
            audioComponentType: 9,
            isOverlap: true,
            allowEndLack: true,
            tags: JSON.stringify([7, 8]),
            parentDirectoryName: 'synthetic-parent',
            directory: 'synthetic/program',
            recordedFormat: 'synthetic-format',
            encodeMode1: 'archive',
            encodeParentDirectoryName1: 'synthetic-encoded-parent-1',
            encodeDirectory1: 'synthetic/archive',
            encodeMode2: 'mobile',
            encodeParentDirectoryName2: 'synthetic-encoded-parent-2',
            encodeDirectory2: 'synthetic/mobile',
            encodeMode3: 'review',
            encodeParentDirectoryName3: 'synthetic-encoded-parent-3',
            encodeDirectory3: 'synthetic/review',
            isDeleteOriginalAfterEncode: true,
        });
        expect(harness.reserveDB.findTimeRanges).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
    });

    it('[RR-4.1] carries allowEndLack, tags, and save options into a candidate', async () => {
        const rule = makeRule({
            reserveOption: { allowEndLack: true, avoidDuplicate: false, enable: true, tags: [11] },
            saveOption: { directory: 'synthetic/save', parentDirectoryName: 'synthetic-parent', recordedFormat: 'ts' },
        });
        const harness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [makeProgram()]) },
            ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn() },
        });
        const consumer = installCandidateConsumer(harness.model);

        await harness.model.updateRule(17);

        expect(consumer.mock.calls[0][1][0]).toMatchObject({
            allowEndLack: true,
            directory: 'synthetic/save',
            parentDirectoryName: 'synthetic-parent',
            recordedFormat: 'ts',
            tags: JSON.stringify([11]),
        });
    });

    it('[RR-4.3] rejects invalid recording-option combinations before persistence or notification', async () => {
        const repository = {
            findId: vi.fn(async () => makeRule()),
            insertOnce: vi.fn(async () => 71),
            updateOnce: vi.fn(async () => undefined),
        };
        const event = { emitAdded: vi.fn(), emitUpdated: vi.fn() };
        const manager = new RuleManageModel(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            { checkRuleOption: () => false },
            repository,
            event,
        );

        await expect(manager.add(makeRule())).rejects.toThrow('AddRuleError');
        await expect(manager.update(makeRule({ id: 71 }))).rejects.toThrow('UpdateRuleError');

        expect(repository.insertOnce).not.toHaveBeenCalled();
        expect(repository.updateOnce).not.toHaveBeenCalled();
        expect(event.emitAdded).not.toHaveBeenCalled();
        expect(event.emitUpdated).not.toHaveBeenCalled();
    });

    describe('[RR-4.3] sub directory that leaves the recording directory', () => {
        const makeManager = () => {
            const repository = {
                findId: vi.fn(async () => makeRule()),
                insertOnce: vi.fn(async () => 71),
                updateOnce: vi.fn(async () => undefined),
            };
            const event = { emitAdded: vi.fn(), emitUpdated: vi.fn() };
            const checker = { checkRuleOption: vi.fn(() => true) };
            const manager = new RuleManageModel(
                { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
                checker,
                repository,
                event,
            );
            return { checker, event, manager, repository };
        };

        it.each([
            ['saveOption.directory', { saveOption: { directory: '../outside' } }],
            ['saveOption.directory with a leading separator', { saveOption: { directory: rooted('../outside') } }],
            ['saveOption.directory that leaves after descending', { saveOption: { directory: 'a/../../outside' } }],
            ['saveOption.directory with a NUL character', { saveOption: { directory: 'synthetic\0directory' } }],
            ['encodeOption.directory1', { encodeOption: { mode1: 'archive', directory1: '../outside' } }],
            ['encodeOption.directory2', { encodeOption: { mode2: 'archive', directory2: '/../outside' } }],
            ['encodeOption.directory3', { encodeOption: { mode3: 'archive', directory3: 'a/../../outside' } }],
        ])('rejects add and update whose %s is outside before persistence or notification', async (_label, options) => {
            const { checker, event, manager, repository } = makeManager();

            await expect(manager.add(makeRule(options))).rejects.toThrow('InvalidSubDirectory');
            await expect(manager.update(makeRule({ id: 71, ...options }))).rejects.toThrow('InvalidSubDirectory');

            expect(checker.checkRuleOption).not.toHaveBeenCalled();
            expect(repository.insertOnce).not.toHaveBeenCalled();
            expect(repository.updateOnce).not.toHaveBeenCalled();
            expect(event.emitAdded).not.toHaveBeenCalled();
            expect(event.emitUpdated).not.toHaveBeenCalled();
        });

        it('still reports a missing rule before the sub directory when updating', async () => {
            const { manager, repository } = makeManager();
            repository.findId.mockResolvedValue(null as never);

            await expect(
                manager.update(makeRule({ id: 72, saveOption: { directory: '../outside' } })),
            ).rejects.toThrow('RuleIsNotFound');
        });

        it.each([
            ['saveOption.directory a/../b', { saveOption: { directory: 'a/../b' } }],
            ['saveOption.directory /anime', { saveOption: { directory: rooted('anime') } }],
            ['encodeOption.directory1 /anime', { encodeOption: { mode1: 'archive', directory1: '/anime' } }],
        ])('keeps accepting %s, which stays inside the recording directory', async (_label, options) => {
            const { event, manager, repository } = makeManager();
            const rule = makeRule({ id: 73, ...options });

            await expect(manager.add(rule)).resolves.toBe(71);
            await expect(manager.update(rule)).resolves.toBeUndefined();

            expect(repository.insertOnce).toHaveBeenCalledExactlyOnceWith(rule);
            expect(repository.updateOnce).toHaveBeenCalledExactlyOnceWith(rule);
            expect(event.emitAdded).toHaveBeenCalledOnce();
            expect(event.emitUpdated).toHaveBeenCalledOnce();
        });
    });

    it('[RR-4.4] preserves omitted recording values without inventing option content', async () => {
        const rule = makeRule({
            reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false },
            encodeOption: { mode1: 'archive', isDeleteOriginalAfterEncode: false },
        });
        const harness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [makeProgram()]) },
            ruleDB: { findId: vi.fn(async () => rule), getIds: vi.fn() },
        });
        const consumer = installCandidateConsumer(harness.model);

        await harness.model.updateRule(17);

        const candidate = consumer.mock.calls[0][1][0];
        expect(rule.reserveOption).not.toHaveProperty('tags');
        expect(rule).not.toHaveProperty('saveOption');
        expect(rule.encodeOption).toEqual({ mode1: 'archive', isDeleteOriginalAfterEncode: false });
        expect(candidate).toMatchObject({
            allowEndLack: false,
            tags: null,
            parentDirectoryName: null,
            directory: null,
            recordedFormat: null,
            encodeMode1: 'archive',
            encodeParentDirectoryName1: null,
            encodeDirectory1: null,
            encodeMode2: null,
            encodeParentDirectoryName2: null,
            encodeDirectory2: null,
            encodeMode3: null,
            encodeParentDirectoryName3: null,
            encodeDirectory3: null,
            isDeleteOriginalAfterEncode: false,
        });
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
    });
});
