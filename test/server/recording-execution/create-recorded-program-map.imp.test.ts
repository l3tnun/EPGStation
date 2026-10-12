import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecorder, makeReserve } from './_harness';

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Program-shaped row returned by findChannelIdAndTime for the time-specified
 * createRecorded map residual (L1368–1389).
 */
const makeProgram = (overrides: Record<string, unknown> = {}) =>
    ({
        name: 'synthetic-mapped-name',
        halfWidthName: 'synthetic-mapped-half',
        description: 'synthetic-description',
        halfWidthDescription: 'synthetic-half-description',
        extended: 'synthetic-extended',
        halfWidthExtended: 'synthetic-half-extended',
        rawExtended: 'synthetic-raw-extended',
        rawHalfWidthExtended: 'synthetic-raw-half-width-extended',
        genre1: 1,
        subGenre1: 11,
        genre2: 2,
        subGenre2: 12,
        genre3: 3,
        subGenre3: 13,
        videoType: 'mpeg2',
        videoResolution: '1080i',
        videoStreamContent: 6,
        videoComponentType: 5,
        audioSamplingRate: 48_000,
        audioComponentType: 4,
        ...overrides,
    }) as Record<string, unknown>;

describe('RecorderModel.createRecorded time-specified program-map (unittest/imp)', () => {
    it('[R2-RECORDER-CREATE-RECORDED-PROGRAM-MAP] maps program metadata when findChannelIdAndTime returns a program', async () => {
        const program = makeProgram();
        const findChannelIdAndTime = vi.fn(async () => program);
        const harness = makeRecorder({
            programDB: {
                findId: vi.fn(async () => null),
                findChannelIdAndTime,
            },
        });
        harness.model.reserve = makeReserve({
            id: 77,
            isTimeSpecified: true,
            channelId: 10,
            startAt: 1_000,
            endAt: 2_000,
            programId: null,
            ruleId: 9,
        });
        harness.model.isRecording = true;
        harness.model.recordedId = null;
        harness.model.dropLogFileId = null;

        const recorded = await harness.model.createRecorded();

        expect(findChannelIdAndTime).toHaveBeenCalledExactlyOnceWith(10, 1_000);
        expect(recorded).toMatchObject({
            isRecording: true,
            reserveId: 77,
            ruleId: 9,
            programId: null,
            channelId: 10,
            startAt: 1_000,
            endAt: 2_000,
            duration: 1_000,
            name: 'synthetic-mapped-name',
            halfWidthName: 'synthetic-mapped-half',
            description: 'synthetic-description',
            halfWidthDescription: 'synthetic-half-description',
            extended: 'synthetic-extended',
            halfWidthExtended: 'synthetic-half-extended',
            rawExtended: 'synthetic-raw-extended',
            rawHalfWidthExtended: 'synthetic-raw-half-width-extended',
            genre1: 1,
            subGenre1: 11,
            genre2: 2,
            subGenre2: 12,
            genre3: 3,
            subGenre3: 13,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 6,
            videoComponentType: 5,
            audioSamplingRate: 48_000,
            audioComponentType: 4,
        });
        expect(recorded).not.toHaveProperty('dropLogFileId');
    });
});
