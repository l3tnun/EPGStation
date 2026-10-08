import { describe, expect, it, vi } from 'vitest';
import { ChannelDB, logger, m3uEntry, makeChannel, makeModel, makeProgram, ProgramDB } from '../../_harness';

const loggerModel = { getLogger: () => logger };
const immediateRetry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };

describe('IPTV ordering compatibility', () => {
    it.each([
        [{ channelOrder: [20], sidOrder: [103] }, [20, 10, 30]],
        [{ channelOrder: [20] }, [20, 10, 30]],
        [{ sidOrder: [103] }, [30, 10, 20]],
        [{}, [10, 20, 30]],
    ])('[Task 2.2] applies channelOrder, sidOrder, and standard remainder for config %#', (config, expected) => {
        const rows = [
            makeChannel({ id: 10, serviceId: 101 }),
            makeChannel({ id: 20, serviceId: 102 }),
            makeChannel({ id: 30, serviceId: 103 }),
        ];
        const channelDB = new ChannelDB(loggerModel, { getConfig: () => config }, {}, {});

        expect(channelDB.sortChannels([...rows]).map((row: any) => row.id)).toEqual(expected);
    });

    it('[Task 2.2] preserves configured DB order, ids, live URLs, U+3000, and LF as exact bytes', async () => {
        const channels = [
            makeChannel({ id: 30, name: '設定局三', hasLogoData: false }),
            makeChannel({ id: 10, name: '設定局一', hasLogoData: true }),
            makeChannel({ id: 20, name: '設定局二', hasLogoData: false }),
        ];
        const harness = makeModel({ channelDB: { findAll: async () => channels } });
        const result = await harness.model.getChannelList('synthetic.invalid', false, 5, false);

        expect(Buffer.from(result, 'utf8')).toEqual(
            Buffer.from('#EXTM3U\n' + channels.map(channel => m3uEntry(channel, channel.name, 5)).join(''), 'utf8'),
        );
    });

    it.each([2, 3, 4])(
        '[Task 2.2 defect locator] isolates the duplicate-name suffix difference for %i rows',
        async count => {
            const channels = Array.from({ length: count }, (_, index) =>
                makeChannel({ id: index + 1, hasLogoData: true, name: '同名局' }),
            );
            const harness = makeModel({ channelDB: { findAll: async () => channels } });
            const approved =
                '#EXTM3U\n' +
                channels
                    .map((channel, index) => m3uEntry(channel, `同名局${index === 0 ? '' : ' '.repeat(index + 1)}`))
                    .join('');
            const result = await harness.model.getChannelList('synthetic.invalid', false, 2, false);

            expect(Buffer.from(result, 'utf8')).toEqual(Buffer.from(approved, 'utf8'));
        },
    );

    it('[Task 3.1] requests inclusive period endpoints, all four waves, and no secondary programme order', async () => {
        const find = vi.fn(async () => []);
        const programDB = new ProgramDB(
            loggerModel,
            { getConfig: () => ({}) },
            { getConnection: async () => ({ getRepository: () => ({ find }) }) },
            immediateRetry,
        );

        await programDB.findSchedule({
            startAt: 1_000,
            endAt: 2_000,
            isHalfWidth: false,
            types: ['GR', 'BS', 'CS', 'SKY'],
        });

        expect(find).toHaveBeenCalledOnce();
        const options = find.mock.calls[0][0] as Record<string, any>;
        expect(options.order).toEqual({ startAt: 'ASC' });
        expect(Object.keys(options.order)).toEqual(['startAt']);
        expect(
            options.where.map((entry: Record<string, any>) => ({
                channelType: entry.channelType,
                endAt: { type: entry.endAt._type, value: entry.endAt._value },
                startAt: { type: entry.startAt._type, value: entry.startAt._value },
            })),
        ).toEqual(
            ['GR', 'BS', 'CS', 'SKY'].map(channelType => ({
                channelType,
                endAt: { type: 'moreThanOrEqual', value: 1_000 },
                startAt: { type: 'lessThanOrEqual', value: 2_000 },
            })),
        );
    });

    it('[Task 3.1] uses standard channel order and preserves DB order for equal programme start times', async () => {
        const channels = [makeChannel({ id: 20 }), makeChannel({ id: 10 })];
        const programs = [
            makeProgram({ id: 2, channelId: 10, name: 'same-time-second', startAt: 1_000, endAt: 2_000 }),
            makeProgram({ id: 3, channelId: 20, name: 'standard-channel-first', startAt: 1_000, endAt: 2_000 }),
            makeProgram({ id: 1, channelId: 10, name: 'same-time-first', startAt: 1_000, endAt: 2_000 }),
        ];
        const harness = makeModel({
            channelDB: { findAll: async () => channels },
            programDB: { findSchedule: async () => programs },
        });
        const result = await harness.model.getEpg(1, false);
        expect(result.indexOf('<channel id="20"')).toBeLessThan(result.indexOf('<channel id="10"'));
        expect(result.indexOf('<title lang="ja_JP">standard-channel-first')).toBeLessThan(
            result.indexOf('<channel id="10"'),
        );
        expect(result.indexOf('<title lang="ja_JP">same-time-second')).toBeLessThan(
            result.indexOf('<title lang="ja_JP">same-time-first'),
        );
    });

    it('[Task 3.1] asks ChannelDB for the standard wave, remote-control, and service order', async () => {
        const rows = [makeChannel({ id: 10 })];
        const queryBuilder: Record<string, any> = {
            getMany: vi.fn(async () => rows),
        };
        queryBuilder.orderBy = vi.fn(() => queryBuilder);
        const createQueryBuilder = vi.fn(() => queryBuilder);
        const channelDB = new ChannelDB(
            loggerModel,
            { getConfig: () => ({}) },
            {
                getConnection: async () => ({
                    getRepository: () => ({ createQueryBuilder }),
                }),
            },
            immediateRetry,
        );

        await expect(channelDB.findAll()).resolves.toEqual(rows);
        expect(createQueryBuilder).toHaveBeenCalledWith('channel');
        expect(queryBuilder.orderBy).toHaveBeenCalledWith(
            'channel.channelTypeId, channel.remoteControlKeyId, channel.serviceId',
            'ASC',
        );
    });
});
