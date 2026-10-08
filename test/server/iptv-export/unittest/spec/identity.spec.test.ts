import { describe, expect, it, vi } from 'vitest';
import { m3uEntry, makeChannel, makeModel, makeProgram } from '../../_harness';
import { registerCanonicalContracts } from './canonical-contract-case';
import { canonicalIdentityCases } from './canonical-identity-cases';

describe('IPTV channel identity', () => {
    it('[Task 3.1] keeps persisted ids across different M3U8 and XMLTV orders as exact documents', async () => {
        const standardChannels = [
            makeChannel({ id: 10, serviceId: 101, name: '標準局一', hasLogoData: false }),
            makeChannel({ id: 20, serviceId: 102, name: '標準局二', hasLogoData: false }),
        ];
        const configuredChannels = [standardChannels[1], standardChannels[0]];
        const programs = [
            makeProgram({
                id: 1001,
                channelId: 10,
                name: '標準番組一',
                description: null,
                startAt: 1_700_000_000_000,
                endAt: 1_700_000_060_000,
            }),
            makeProgram({
                id: 1002,
                channelId: 20,
                name: '標準番組二',
                description: null,
                startAt: 1_700_000_060_000,
                endAt: 1_700_000_120_000,
            }),
        ];
        const findAll = vi.fn(async (needSort?: boolean) =>
            needSort === true ? configuredChannels : standardChannels,
        );
        const harness = makeModel({
            channelDB: { findAll },
            programDB: { findSchedule: async () => programs },
        });
        const m3u = await harness.model.getChannelList('synthetic.invalid', false, 3, false);
        const xml = await harness.model.getEpg(1, false);

        expect(Buffer.from(m3u, 'utf8')).toEqual(
            Buffer.from(
                '#EXTM3U\n' + configuredChannels.map(channel => m3uEntry(channel, channel.name, 3)).join(''),
                'utf8',
            ),
        );
        expect(Buffer.from(xml, 'utf8')).toEqual(
            Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                    '<tv generator-info-name="EPGStation">' +
                    '<channel id="10" tp="synthetic-channel">' +
                    '<display-name lang="ja_JP">標準局一</display-name>' +
                    '<service_id>101</service_id></channel>\n' +
                    `<programme start="${harness.model.getTimeStr(programs[0].startAt)}" stop="${harness.model.getTimeStr(
                        programs[0].endAt,
                    )}" channel="10">` +
                    '<title lang="ja_JP">標準番組一</title></programme>' +
                    '<channel id="20" tp="synthetic-channel">' +
                    '<display-name lang="ja_JP">標準局二</display-name>' +
                    '<service_id>102</service_id></channel>\n' +
                    `<programme start="${harness.model.getTimeStr(programs[1].startAt)}" stop="${harness.model.getTimeStr(
                        programs[1].endAt,
                    )}" channel="20">` +
                    '<title lang="ja_JP">標準番組二</title></programme></tv>',
                'utf8',
            ),
        );
        expect([...m3u.matchAll(/tvg-id="(\d+)"/g)].map(match => Number(match[1]))).toEqual([20, 10]);
        expect([...m3u.matchAll(/live\/(\d+)\/m2ts/g)].map(match => Number(match[1]))).toEqual([20, 10]);
        expect([...xml.matchAll(/<channel id="(\d+)"/g)].map(match => Number(match[1]))).toEqual([10, 20]);
        expect([...xml.matchAll(/<programme [^>]* channel="(\d+)"/g)].map(match => Number(match[1]))).toEqual([10, 20]);
        expect(findAll.mock.calls).toEqual([[true], []]);
    });

});

registerCanonicalContracts(canonicalIdentityCases);
