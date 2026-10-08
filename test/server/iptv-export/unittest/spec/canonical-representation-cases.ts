import { expect } from 'vitest';
import { makeChannel, makeModel, makeProgram } from '../../_harness';
import { defineCanonicalContract, type CanonicalContractCase } from './canonical-contract-case';
import {
    expectExactDocument,
    localTimeString,
    m3u8Declaration,
    m3u8Entry,
    xmltvChannel,
    xmltvDocument,
    xmltvProgramme,
} from './canonical-document';

const file = 'representation.spec.test.ts';

const xmltvFor = async (program: Record<string, any>, channel = makeChannel()): Promise<string> =>
    makeModel({
        channelDB: { findAll: async () => [channel] },
        programDB: { findSchedule: async () => [program] },
    }).model.getEpg(1, false);

export const canonicalRepresentationCases: readonly CanonicalContractCase[] = [
    defineCanonicalContract(
        'Requirement 5.1',
        file,
        'replaces all five reserved programme symbols with full-width analogues',
        'the five normalized symbols are exact public XMLTV bytes',
        async () => {
            const document = await xmltvFor(makeProgram({ name: `<>&"'`, description: `<>&"'`, extended: null }));
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, title: '＜＞＆”’', description: '＜＞＆”’' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 5.2',
        file,
        'removes SUB from programme title and description text',
        'no SUB byte remains in public XMLTV programme text',
        async () => {
            const document = await xmltvFor(
                makeProgram({ name: 'TITLE\x1aTEXT', description: 'DESC\x1aTEXT', extended: null }),
            );
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, title: 'TITLETEXT', description: 'DESCTEXT' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 5.3',
        file,
        'does not apply programme normalization to channel fields or M3U8',
        'reserved symbols and SUB remain externally visible in non-programme fields',
        async () => {
            const symbols = `<>&"'\x1a`;
            const channel = makeChannel({ name: symbols, channel: symbols, channelType: symbols, hasLogoData: false });
            const model = makeModel({
                channelDB: { findAll: async () => [channel] },
                programDB: { findSchedule: async () => [makeProgram({ description: null, extended: null })] },
            }).model;
            const [m3u8, xmltv] = await Promise.all([
                model.getChannelList('synthetic.invalid', false, 2, false),
                model.getEpg(1, false),
            ]);
            expectExactDocument(m3u8, m3u8Declaration + m3u8Entry({ id: 10, displayName: symbols, group: symbols }));
            expectExactDocument(
                xmltv,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: symbols, tp: symbols }),
                    xmltvProgramme({ channelId: 10, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 5.4',
        file,
        'formats start and stop in server-local year-to-second form',
        'both timestamps use exactly fourteen local datetime digits',
        async () => {
            const program = makeProgram({
                startAt: 1_700_000_000_000,
                endAt: 1_700_000_060_000,
                description: null,
                extended: null,
            });
            const document = await xmltvFor(program);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({
                        channelId: 10,
                        startAt: 1_700_000_000_000,
                        endAt: 1_700_000_060_000,
                        title: '通常番組',
                    }),
                ),
            );
            const timestamps = [...document.matchAll(/(?:start|stop)="(\d{14} [+-]\d{4})"/g)].map(match => match[1]);
            expect(timestamps).toEqual([localTimeString(1_700_000_000_000), localTimeString(1_700_000_060_000)]);
        },
    ),
    defineCanonicalContract(
        'Requirement 5.5',
        file,
        'uses the UTC offset selected when the IPTV model module loaded',
        'the module offset follows one ASCII space in both public timestamps',
        async () => {
            const offset = new Date().toString().replace(/^.*GMT([+-]\d{4}).*$/, '$1');
            const program = makeProgram({ description: null, extended: null });
            const document = await xmltvFor(program);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, title: '通常番組' }),
                ),
            );
            expect(document.match(new RegExp(` ${offset.replace('+', '\\+')}"`, 'g'))).toHaveLength(2);
        },
    ),
    defineCanonicalContract(
        'Requirement 5.6',
        file,
        'keeps the module-load UTC offset after a runtime timezone change',
        'timestamp suffixes retain the already selected offset',
        async () => {
            const originalTimezone = process.env.TZ;
            const model = makeModel().model;
            const fixedOffset = model.getTimeStr(1_700_000_000_000).slice(-5);
            try {
                process.env.TZ = fixedOffset === '+0000' ? 'Asia/Tokyo' : 'UTC';
                expect(model.getTimeStr(1_700_000_000_000).slice(-5)).toBe(fixedOffset);
            } finally {
                if (originalTimezone === undefined) delete process.env.TZ;
                else process.env.TZ = originalTimezone;
            }
        },
    ),
];
