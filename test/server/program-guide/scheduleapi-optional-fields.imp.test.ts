import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const ScheduleApiModel = (
    require(join(snapshot, 'model', 'api', 'schedule', 'ScheduleApiModel.js')) as {
        default: new (...args: unknown[]) => {
            getSchedule(programId: number, isHalfWidth: boolean): Promise<unknown>;
            getSchedules(option: Record<string, unknown>): Promise<unknown[]>;
        };
    }
).default;

const makeProgram = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    channelId: 10,
    startAt: 1_000,
    endAt: 2_000,
    isFree: true,
    name: 'synthetic-name',
    halfWidthName: 'synthetic-half-name',
    description: null,
    halfWidthDescription: null,
    extended: null,
    halfWidthExtended: null,
    rawExtended: null,
    rawHalfWidthExtended: null,
    genre1: null,
    subGenre1: null,
    genre2: null,
    subGenre2: null,
    genre3: null,
    subGenre3: null,
    videoType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoComponentType: null,
    audioSamplingRate: null,
    audioComponentType: null,
    ...overrides,
});

const makeChannel = (id: number) => ({
    id,
    serviceId: id * 10,
    networkId: 32_736,
    name: `channel-${id}`,
    halfWidthName: `half-channel-${id}`,
    hasLogoData: false,
    channelType: 'GR',
    type: 1,
    remoteControlKeyId: null,
});

/**
 * ScheduleApiModel が番組を番組表の項目へ変換する際、値のある任意の項目だけを応答へ載せ、
 * 番組の無いチャンネルは番組表から外す。
 */
describe('ScheduleApiModel optional program fields and empty channels (unittest/imp)', () => {
    it('[PG-I-073] copies every present genre, video and audio attribute onto the program item', async () => {
        const program = makeProgram({
            genre2: 2,
            subGenre2: 21,
            genre3: 3,
            subGenre3: 31,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 5,
            videoComponentType: 179,
            audioSamplingRate: 48_000,
            audioComponentType: 3,
        });
        const model = new ScheduleApiModel({}, { findId: vi.fn(async () => program) });

        await expect(model.getSchedule(1, false)).resolves.toEqual({
            id: 1,
            channelId: 10,
            startAt: 1_000,
            endAt: 2_000,
            isFree: true,
            name: 'synthetic-name',
            genre2: 2,
            subGenre2: 21,
            genre3: 3,
            subGenre3: 31,
            videoType: 'mpeg2',
            videoResolution: '1080i',
            videoStreamContent: 5,
            videoComponentType: 179,
            audioSamplingRate: 48_000,
            audioComponentType: 3,
        });
    });

    it('[PG-I-073] omits every optional attribute that is null', async () => {
        const model = new ScheduleApiModel({}, { findId: vi.fn(async () => makeProgram()) });

        const item = (await model.getSchedule(1, true)) as Record<string, unknown>;

        expect(item).toEqual({
            id: 1,
            channelId: 10,
            startAt: 1_000,
            endAt: 2_000,
            isFree: true,
            name: 'synthetic-half-name',
        });
    });

    it('[PG-I-073] leaves a channel without programs out of the schedule', async () => {
        const findChannleTypes = vi.fn(async () => [makeChannel(10), makeChannel(11)]);
        const findSchedule = vi.fn(async () => [makeProgram({ channelId: 11, id: 5 })]);
        const model = new ScheduleApiModel({ findChannleTypes }, { findSchedule });

        const schedules = (await model.getSchedules({
            GR: true,
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            isFree: false,
        })) as Array<{ channel: { id: number }; programs: Array<{ id: number }> }>;

        expect(schedules).toHaveLength(1);
        expect(schedules[0].channel.id).toBe(11);
        expect(schedules[0].programs.map(program => program.id)).toEqual([5]);
    });
});
