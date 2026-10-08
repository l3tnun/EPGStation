import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createDialectPersistence,
    makeProgram,
    makeReservationHarness,
    makeRule,
} from '../fixtures/reservation-rules/runtime';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('candidate projection implementation boundaries', () => {
    it('[IMP-CANDIDATE-PROJECTION] retains every recording option through the reservation handoff', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-01-07T00:00:00+09:00').getTime());
        const recordingOptions = {
            encodeOption: {
                directory1: 'synthetic/one',
                directory2: 'synthetic/two',
                directory3: 'synthetic/three',
                encodeParentDirectoryName1: 'synthetic-parent-one',
                encodeParentDirectoryName2: 'synthetic-parent-two',
                encodeParentDirectoryName3: 'synthetic-parent-three',
                isDeleteOriginalAfterEncode: true,
                mode1: 'synthetic-mode-one',
                mode2: 'synthetic-mode-two',
                mode3: 'synthetic-mode-three',
            },
            reserveOption: {
                allowEndLack: true,
                avoidDuplicate: false,
                enable: true,
                tags: ['synthetic-tag'],
            },
            saveOption: {
                directory: 'synthetic-recordings',
                parentDirectoryName: 'synthetic-parent',
                recordedFormat: 'synthetic-format',
            },
        };

        const programWrites: Array<Array<Record<string, unknown>>> = [];
        const programTarget = makeProgram({
            audioComponentType: 901,
            audioSamplingRate: 48_000,
            channel: 'synthetic-program-channel',
            channelId: 401,
            channelType: 'BS',
            description: 'synthetic-program-description',
            endAt: 1_900_000_030_000,
            extended: 'synthetic-program-extended',
            genre1: 1,
            genre2: 3,
            genre3: 5,
            halfWidthDescription: 'synthetic-program-description',
            halfWidthExtended: 'synthetic-program-extended',
            halfWidthName: 'synthetic-program-name',
            id: 701,
            name: 'synthetic-program-name',
            programUpdateTime: 811,
            rawExtended: '{"synthetic":"program"}',
            rawHalfWidthExtended: '{"synthetic":"program"}',
            shortName: 'synthetic-program-short-name',
            startAt: 1_900_000_000_000,
            subGenre1: 2,
            subGenre2: 4,
            subGenre3: 6,
            updateTime: 811,
            videoComponentType: 902,
            videoResolution: 903,
            videoStreamContent: 904,
            videoType: 905,
        });
        const programHarness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [programTarget]) },
            reserveDB: {
                findRuleId: vi.fn(async () => []),
                findTimeRanges: vi.fn(async () => []),
                updateMany: vi.fn(async (diff: { insert?: Array<Record<string, unknown>> }) => {
                    programWrites.push(diff.insert ?? []);
                }),
            },
            ruleDB: {
                findId: vi.fn(async () => makeRule({ ...recordingOptions, id: 41, updateCnt: 8 })),
                getIds: vi.fn(async () => []),
            },
        });

        await programHarness.model.updateRule(41);
        expect(programWrites).toEqual([
            [
                expect.objectContaining({
                    allowEndLack: true,
                    audioComponentType: 901,
                    audioSamplingRate: 48_000,
                    channel: 'synthetic-program-channel',
                    channelId: 401,
                    channelType: 'BS',
                    description: 'synthetic-program-description',
                    directory: 'synthetic-recordings',
                    endAt: 1_900_000_030_000,
                    encodeDirectory1: 'synthetic/one',
                    encodeDirectory2: 'synthetic/two',
                    encodeDirectory3: 'synthetic/three',
                    encodeMode1: 'synthetic-mode-one',
                    encodeMode2: 'synthetic-mode-two',
                    encodeMode3: 'synthetic-mode-three',
                    encodeParentDirectoryName1: 'synthetic-parent-one',
                    encodeParentDirectoryName2: 'synthetic-parent-two',
                    encodeParentDirectoryName3: 'synthetic-parent-three',
                    extended: 'synthetic-program-extended',
                    genre1: 1,
                    genre2: 3,
                    genre3: 5,
                    halfWidthDescription: 'synthetic-program-description',
                    halfWidthExtended: 'synthetic-program-extended',
                    halfWidthName: 'synthetic-program-name',
                    isDeleteOriginalAfterEncode: true,
                    isOverlap: false,
                    name: 'synthetic-program-name',
                    parentDirectoryName: 'synthetic-parent',
                    programId: 701,
                    programUpdateTime: 811,
                    rawExtended: '{"synthetic":"program"}',
                    rawHalfWidthExtended: '{"synthetic":"program"}',
                    recordedFormat: 'synthetic-format',
                    ruleId: 41,
                    ruleUpdateCnt: 8,
                    shortName: 'synthetic-program-short-name',
                    startAt: 1_900_000_000_000,
                    subGenre1: 2,
                    subGenre2: 4,
                    subGenre3: 6,
                    tags: JSON.stringify(['synthetic-tag']),
                    videoComponentType: 902,
                    videoResolution: 903,
                    videoStreamContent: 904,
                    videoType: 905,
                }),
            ],
        ]);

        const timeWrites: Array<Array<Record<string, unknown>>> = [];
        const timeHarness = makeReservationHarness({
            channelDB: {
                findId: vi.fn(async () => ({
                    channel: 'synthetic-channel',
                    channelType: 'GR',
                    id: 101,
                    name: 'Synthetic',
                })),
            },
            reserveDB: {
                findRuleId: vi.fn(async () => []),
                findTimeRanges: vi.fn(async () => []),
                updateMany: vi.fn(async (diff: { insert?: Array<Record<string, unknown>> }) => {
                    timeWrites.push(diff.insert ?? []);
                }),
            },
            ruleDB: {
                findId: vi.fn(async () =>
                    makeRule({
                        ...recordingOptions,
                        id: 42,
                        isTimeSpecification: true,
                        searchOption: {
                            channelIds: [101],
                            keyword: 'synthetic time candidate',
                            times: [{ range: 60, start: 0, week: 0x7f }],
                        },
                    }),
                ),
                getIds: vi.fn(async () => []),
            },
        });

        await timeHarness.model.updateRule(42);
        expect(timeWrites[0][0]).toEqual(
            expect.objectContaining({
                channel: 'synthetic-channel',
                encodeMode1: 'synthetic-mode-one',
                isDeleteOriginalAfterEncode: true,
                parentDirectoryName: 'synthetic-parent',
                endAt: Date.parse('2030-01-07T00:01:00+09:00'),
                programId: null,
                ruleId: 42,
                startAt: Date.parse('2030-01-07T00:00:00+09:00'),
            }),
        );
    });

    it('[IMP-CANDIDATE-IDENTITY] preserves program and time candidate identities independently', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-01-07T00:00:00+09:00').getTime());

        const programWrites: Array<Array<Record<string, unknown>>> = [];
        const programHarness = makeReservationHarness({
            programDB: { findRule: vi.fn(async () => [makeProgram({ id: 801 })]) },
            reserveDB: {
                findRuleId: vi.fn(async () => []),
                findTimeRanges: vi.fn(async () => []),
                updateMany: vi.fn(async (diff: { insert?: Array<Record<string, unknown>> }) => {
                    programWrites.push(diff.insert ?? []);
                }),
            },
            ruleDB: { findId: vi.fn(async () => makeRule({ id: 61 })), getIds: vi.fn(async () => []) },
        });
        await programHarness.model.updateRule(61);
        expect(programWrites).toEqual([[expect.objectContaining({ programId: 801, ruleId: 61 })]]);

        const timeWrites: Array<Array<Record<string, unknown>>> = [];
        const timeHarness = makeReservationHarness({
            channelDB: {
                findId: vi.fn(async () => ({
                    channel: 'synthetic-channel',
                    channelType: 'GR',
                    id: 101,
                    name: 'Synthetic',
                })),
            },
            reserveDB: {
                findRuleId: vi.fn(async () => []),
                findTimeRanges: vi.fn(async () => []),
                updateMany: vi.fn(async (diff: { insert?: Array<Record<string, unknown>> }) => {
                    timeWrites.push(diff.insert ?? []);
                }),
            },
            ruleDB: {
                findId: vi.fn(async () =>
                    makeRule({
                        id: 62,
                        isTimeSpecification: true,
                        searchOption: {
                            channelIds: [101],
                            keyword: 'synthetic time candidate',
                            times: [{ range: 60, start: 0, week: 0x7f }],
                        },
                    }),
                ),
                getIds: vi.fn(async () => []),
            },
        });
        await timeHarness.model.updateRule(62);
        expect(timeWrites).toEqual([
            expect.arrayContaining([expect.objectContaining({ programId: null, ruleId: 62 })]),
        ]);
    });

    it('[IMP-DUPLICATE-HISTORY-BOUNDARY] marks only the matching recorded-history candidate as possible duplicate', async () => {
        const fixture = await createDialectPersistence('sqlite');
        try {
            vi.useFakeTimers();
            const now = 1_800_000_000_000;
            vi.setSystemTime(now);
            await fixture.source
                .getRepository(fixture.Program)
                .insert([
                    makeProgram({ channelId: 101, endAt: now, id: 711, shortName: 'same' }),
                    makeProgram({ channelId: 202, endAt: now, id: 712, shortName: 'same' }),
                    makeProgram({ channelId: 101, endAt: now + 1, id: 713, shortName: 'same' }),
                    makeProgram({ channelId: 101, endAt: now, id: 714, shortName: 'other' }),
                ]);
            await fixture.source.getRepository(fixture.RecordedHistory).insert({
                channelId: 101,
                endAt: now - 3 * 24 * 60 * 60 * 1000,
                name: 'same',
            });
            await fixture.ruleDB.insertOnce(
                makeRule({
                    id: 51,
                    reserveOption: {
                        allowEndLack: false,
                        avoidDuplicate: true,
                        enable: true,
                        periodToAvoidDuplicate: 3,
                    },
                    searchOption: { channelIds: [101, 202], keyword: 'synthetic', name: true },
                }),
            );
            const writes: Array<Array<{ isOverlap: boolean; programId: number }>> = [];
            const harness = makeReservationHarness({
                programDB: fixture.programDB,
                reserveDB: {
                    findRuleId: vi.fn(async () => []),
                    findTimeRanges: vi.fn(async () => []),
                    updateMany: vi.fn(async (diff: { insert?: Array<{ isOverlap: boolean; programId: number }> }) => {
                        writes.push(diff.insert ?? []);
                    }),
                },
                ruleDB: fixture.ruleDB,
            });

            await harness.model.updateRule(51);
            expect(
                writes.map(candidates => candidates.map(({ isOverlap, programId }) => ({ isOverlap, programId }))),
            ).toEqual([
                [
                    { isOverlap: true, programId: 711 },
                    { isOverlap: false, programId: 712 },
                    { isOverlap: false, programId: 713 },
                    { isOverlap: false, programId: 714 },
                ],
            ]);

            const failedExecution = {
                getExecution: vi.fn(async () => 'history-query-execution'),
                unLockExecution: vi.fn(),
            };
            const failedHistory = makeReservationHarness({
                execution: failedExecution,
                programDB: {
                    findRule: vi.fn(async () => {
                        throw new Error('history-query-rejection');
                    }),
                },
                ruleDB: { findId: vi.fn(async () => makeRule({ id: 52 })), getIds: vi.fn(async () => []) },
            });

            await expect(failedHistory.model.updateRule(52)).rejects.toThrow('history-query-rejection');
            expect(failedExecution.unLockExecution).toHaveBeenCalledExactlyOnceWith('history-query-execution');
            expect(failedHistory.reserveEvent.emitUpdated).not.toHaveBeenCalled();
        } finally {
            await fixture.cleanup();
        }
    });
});
