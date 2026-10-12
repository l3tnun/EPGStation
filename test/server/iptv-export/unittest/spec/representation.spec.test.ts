import { describe, expect, it } from 'vitest';
import { m3uEntry, makeChannel, makeModel, makeProgram } from '../../_harness';
import { registerCanonicalContracts } from './canonical-contract-case';
import { canonicalRepresentationCases } from './canonical-representation-cases';

describe('XMLTV representation', () => {
    it('[Task 3.2] replaces five programme symbols and SUB while preserving non-programme fields as exact bytes', async () => {
        const symbols = `<>&"'\x1a`;
        const channel = makeChannel({ name: symbols, channel: symbols });
        const program = makeProgram({ name: symbols, description: symbols, extended: symbols });
        const harness = makeModel({
            channelDB: { findAll: async () => [channel] },
            programDB: { findSchedule: async () => [program] },
        });
        const result = await harness.model.getEpg(1, false);

        expect(Buffer.from(result, 'utf8')).toEqual(
            Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                    '<tv generator-info-name="EPGStation">' +
                    `<channel id="10" tp="${symbols}">` +
                    `<display-name lang="ja_JP">${symbols}</display-name>` +
                    '<service_id>101</service_id></channel>\n' +
                    `<programme start="${harness.model.getTimeStr(program.startAt)}" stop="${harness.model.getTimeStr(
                        program.endAt,
                    )}" channel="10">` +
                    '<title lang="ja_JP">＜＞＆”’</title>' +
                    '    <desc lang="ja_JP">＜＞＆”’＜＞＆”’</desc></programme></tv>',
                'utf8',
            ),
        );
        expect(Buffer.from(result.slice(result.indexOf('<programme'))).includes(0x1a)).toBe(false);
    });

    it('[Task 3.2] does not apply programme normalization to M3U8 display or group fields', async () => {
        const symbols = `<>&"'\x1a`;
        const channel = makeChannel({ name: symbols, channelType: symbols, hasLogoData: false });
        const harness = makeModel({ channelDB: { findAll: async () => [channel] } });

        const result = await harness.model.getChannelList('synthetic.invalid', false, 9, false);

        expect(Buffer.from(result, 'utf8')).toEqual(Buffer.from('#EXTM3U\n' + m3uEntry(channel, symbols, 9), 'utf8'));
        expect(Buffer.from(result, 'utf8').includes(0x1a)).toBe(true);
    });

    it('[Task 4.1] selects half-width programme fields before normalization and description omission', async () => {
        const channel = makeChannel({ halfWidthName: 'HALF-CHANNEL' });
        const described = makeProgram({
            id: 1_001,
            name: '通常番組',
            halfWidthName: 'HALF<NAME>\x1a',
            description: '通常説明',
            halfWidthDescription: 'HALF&DESCRIPTION\x1a',
            extended: '通常詳細',
            halfWidthExtended: 'HALF"EXTENDED"\'',
        });
        const descriptionless = makeProgram({
            id: 1_002,
            name: '通常番組二',
            halfWidthName: 'HALF-SECOND',
            description: '通常説明二',
            halfWidthDescription: null,
            extended: '通常詳細二',
            halfWidthExtended: 'IGNORED-HALF-DETAIL',
            startAt: described.endAt,
            endAt: described.endAt + 60_000,
        });
        const harness = makeModel({
            channelDB: { findAll: async () => [channel] },
            programDB: { findSchedule: async () => [described, descriptionless] },
        });

        const result = await harness.model.getEpg(1, true);

        expect(Buffer.from(result, 'utf8')).toEqual(
            Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                    '<tv generator-info-name="EPGStation">' +
                    '<channel id="10" tp="synthetic-channel"><display-name lang="ja_JP">HALF-CHANNEL</display-name><service_id>101</service_id></channel>\n' +
                    `<programme start="${harness.model.getTimeStr(described.startAt)}" stop="${harness.model.getTimeStr(described.endAt)}" channel="10">` +
                    '<title lang="ja_JP">HALF＜NAME＞</title>' +
                    '    <desc lang="ja_JP">HALF＆DESCRIPTIONHALF”EXTENDED”’</desc></programme>' +
                    `<programme start="${harness.model.getTimeStr(descriptionless.startAt)}" stop="${harness.model.getTimeStr(descriptionless.endAt)}" channel="10">` +
                    '<title lang="ja_JP">HALF-SECOND</title></programme></tv>',
                'utf8',
            ),
        );
    });

});

registerCanonicalContracts(canonicalRepresentationCases);
