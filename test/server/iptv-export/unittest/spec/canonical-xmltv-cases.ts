import { expect, vi } from 'vitest';
import { makeChannel, makeModel, makeProgram } from '../../_harness';
import { defineCanonicalContract, type CanonicalContractCase } from './canonical-contract-case';
import { expectExactDocument, xmltvChannel, xmltvDocument, xmltvProgramme } from './canonical-document';

const file = 'xmltv.spec.test.ts';
const emptyDocument =
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv generator-info-name="EPGStation"></tv>';

export const canonicalXmltvCases: readonly CanonicalContractCase[] = [
    defineCanonicalContract(
        'Requirement 3.1',
        file,
        'emits the XML declaration, doctype, and generator bytes',
        'all three XMLTV document preamble contracts are public bytes',
        async () => {
            const document = await makeModel().model.getEpg(0, false);
            expect(document).toBe(emptyDocument);
        },
    ),
    defineCanonicalContract(
        'Requirement 3.2',
        file,
        'requests and emits programmes from GR, BS, CS, SKY, and BS4K only',
        'the five supported waves are visible and an unsupported wave is absent',
        async () => {
            const channels = ['GR', 'BS', 'CS', 'SKY', 'BS4K'].map((channelType, index) =>
                makeChannel({ id: index + 1, channelType, name: `${channelType}-CHANNEL` }),
            );
            const programs = channels.map(channel =>
                makeProgram({ channelId: channel.id, name: `${channel.channelType}-PROGRAM` }),
            );
            const findSchedule = vi.fn(async ({ types }: { types: string[] }) =>
                types.join('|') === 'GR|BS|CS|SKY|BS4K' ? programs : [makeProgram({ name: 'UNSUPPORTED-PROGRAM' })],
            );
            const document = await makeModel({
                channelDB: { findAll: async () => channels },
                programDB: { findSchedule },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    ...channels.flatMap(channel => [
                        xmltvChannel({ id: channel.id, displayName: `${channel.channelType}-CHANNEL` }),
                        xmltvProgramme({
                            channelId: channel.id,
                            title: `${channel.channelType}-PROGRAM`,
                            description: '通常説明通常詳細',
                        }),
                    ]),
                ),
            );
            expect(findSchedule).toHaveBeenCalledWith(
                expect.objectContaining({ types: ['GR', 'BS', 'CS', 'SKY', 'BS4K'] }),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.3',
        file,
        'uses exactly 24 hours per requested day',
        'the public programme set is selected with now plus days times 24 hours',
        async () => {
            vi.useFakeTimers();
            vi.setSystemTime(1_700_000_000_000);
            try {
                const findSchedule = vi.fn(async () => []);
                const document = await makeModel({ programDB: { findSchedule } }).model.getEpg(2, false);
                expectExactDocument(document, xmltvDocument());
                expect(findSchedule).toHaveBeenCalledWith(
                    expect.objectContaining({
                        startAt: 1_700_000_000_000,
                        endAt: 1_700_172_800_000,
                    }),
                );
            } finally {
                vi.useRealTimers();
            }
        },
    ),
    defineCanonicalContract(
        'Requirement 3.4',
        file,
        'requests the exact period endpoints and includes programmes touching both of them',
        'the period endpoints reach the programme source unchanged and boundary-touching programmes are public XMLTV entries',
        async () => {
            vi.useFakeTimers();
            vi.setSystemTime(1_700_000_000_000);
            try {
                const periodStart = 1_700_000_000_000;
                const periodEnd = 1_700_086_400_000;
                const channel = makeChannel();
                const programs = [
                    makeProgram({
                        id: 1,
                        name: 'START-BOUNDARY',
                        startAt: periodStart - 3_600_000,
                        endAt: periodStart,
                    }),
                    makeProgram({ id: 2, name: 'END-BOUNDARY', startAt: periodEnd, endAt: periodEnd + 3_600_000 }),
                    makeProgram({
                        id: 3,
                        name: 'BEFORE-PERIOD',
                        startAt: periodStart - 7_200_000,
                        endAt: periodStart - 1,
                    }),
                    makeProgram({ id: 4, name: 'AFTER-PERIOD', startAt: periodEnd + 1, endAt: periodEnd + 3_600_000 }),
                ];
                // 番組情報の取得元の「両端を含む重なり」の条件を、受け取った端点で再現する。
                const findSchedule = vi.fn(async ({ startAt, endAt }: { startAt: number; endAt: number }) =>
                    programs.filter(program => program.startAt <= endAt && program.endAt >= startAt),
                );
                const document = await makeModel({
                    channelDB: { findAll: async () => [channel] },
                    programDB: { findSchedule },
                }).model.getEpg(1, false);
                expect(findSchedule).toHaveBeenCalledExactlyOnceWith({
                    startAt: periodStart,
                    endAt: periodEnd,
                    isHalfWidth: false,
                    types: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
                });
                expectExactDocument(
                    document,
                    xmltvDocument(
                        xmltvChannel({ id: 10, displayName: '通常局' }),
                        xmltvProgramme({
                            channelId: 10,
                            startAt: periodStart - 3_600_000,
                            endAt: periodStart,
                            title: 'START-BOUNDARY',
                            description: '通常説明通常詳細',
                        }),
                        xmltvProgramme({
                            channelId: 10,
                            startAt: periodEnd,
                            endAt: periodEnd + 3_600_000,
                            title: 'END-BOUNDARY',
                            description: '通常説明通常詳細',
                        }),
                    ),
                );
            } finally {
                vi.useRealTimers();
            }
        },
    ),
    defineCanonicalContract(
        'Requirement 3.5',
        file,
        'emits channel identifier, display name, and service identifier',
        'all three persisted channel fields are public XMLTV bytes',
        async () => {
            const channel = makeChannel({ id: 42, name: 'VISIBLE-CHANNEL', serviceId: 4242 });
            const program = makeProgram({ channelId: 42, description: null, extended: null });
            const document = await makeModel({
                channelDB: { findAll: async () => [channel] },
                programDB: { findSchedule: async () => [program] },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 42, displayName: 'VISIBLE-CHANNEL', serviceId: 4242 }),
                    xmltvProgramme({ channelId: 42, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.6',
        file,
        'emits the programme channel identifier',
        'the programme channel attribute contains its persisted channel ID',
        async () => {
            const channel = makeChannel({ id: 42 });
            const program = makeProgram({ channelId: 42, description: null, extended: null });
            const document = await makeModel({
                channelDB: { findAll: async () => [channel] },
                programDB: { findSchedule: async () => [program] },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 42, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 42, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.7',
        file,
        'emits programme start and stop timestamps',
        'both formatted timestamp attributes are public XMLTV bytes',
        async () => {
            const program = makeProgram({
                startAt: 1_700_000_000_000,
                endAt: 1_700_000_060_000,
                description: null,
                extended: null,
            });
            const document = await makeModel({
                channelDB: { findAll: async () => [makeChannel()] },
                programDB: { findSchedule: async () => [program] },
            }).model.getEpg(1, false);
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
        },
    ),
    defineCanonicalContract(
        'Requirement 3.8',
        file,
        'emits the selected programme title notation',
        'normal and half-width programme titles are selected by the request',
        async () => {
            const program = makeProgram({
                name: 'NORMAL-TITLE',
                halfWidthName: 'HALF-TITLE',
                description: null,
                halfWidthDescription: null,
            });
            const model = makeModel({
                channelDB: { findAll: async () => [makeChannel()] },
                programDB: { findSchedule: async () => [program] },
            }).model;
            const [normal, half] = await Promise.all([model.getEpg(1, false), model.getEpg(1, true)]);
            expectExactDocument(
                normal,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, title: 'NORMAL-TITLE' }),
                ),
            );
            expectExactDocument(
                half,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: 'ﾊﾝｶｸ局' }),
                    xmltvProgramme({ channelId: 10, title: 'HALF-TITLE' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.9',
        file,
        'emits the normal description when present',
        'the persisted normal description is public desc text',
        async () => {
            const program = makeProgram({ description: 'VISIBLE-DESCRIPTION', extended: null });
            const document = await makeModel({
                channelDB: { findAll: async () => [makeChannel()] },
                programDB: { findSchedule: async () => [program] },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, title: '通常番組', description: 'VISIBLE-DESCRIPTION' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.10',
        file,
        'concatenates normal and extended descriptions in order',
        'normal description bytes precede extended description bytes',
        async () => {
            const program = makeProgram({ description: 'NORMAL-DESC', extended: 'EXTENDED-DESC' });
            const document = await makeModel({
                channelDB: { findAll: async () => [makeChannel()] },
                programDB: { findSchedule: async () => [program] },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, title: '通常番組', description: 'NORMAL-DESCEXTENDED-DESC' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.11',
        file,
        'omits a detail-only description when the normal description is absent',
        'detail text is absent and no desc element is emitted',
        async () => {
            const program = makeProgram({ description: null, extended: 'DETAIL-MUST-NOT-APPEAR' });
            const document = await makeModel({
                channelDB: { findAll: async () => [makeChannel()] },
                programDB: { findSchedule: async () => [program] },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.12',
        file,
        'emits channels in the standard DB snapshot order',
        'the public channel order is the wave/remote/service snapshot order',
        async () => {
            const channels = [10, 20, 30].map(id => makeChannel({ id, name: `CHANNEL-${id}` }));
            const programs = channels.map(channel =>
                makeProgram({ channelId: channel.id, description: null, extended: null }),
            );
            const findAll = vi.fn(async () => channels);
            const document = await makeModel({
                channelDB: { findAll },
                programDB: { findSchedule: async () => programs },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    ...[10, 20, 30].flatMap(id => [
                        xmltvChannel({ id, displayName: `CHANNEL-${id}` }),
                        xmltvProgramme({ channelId: id, title: '通常番組' }),
                    ]),
                ),
            );
            expect(findAll).toHaveBeenCalledWith();
        },
    ),
    defineCanonicalContract(
        'Requirement 3.13',
        file,
        'emits each channel programmes in start-time order',
        'the public programme sequence follows the DB start-time snapshot',
        async () => {
            const programs = [
                makeProgram({ id: 1, name: 'FIRST', startAt: 1, endAt: 2, description: null, extended: null }),
                makeProgram({ id: 2, name: 'SECOND', startAt: 2, endAt: 3, description: null, extended: null }),
            ];
            const document = await makeModel({
                channelDB: { findAll: async () => [makeChannel()] },
                programDB: { findSchedule: async () => programs },
            }).model.getEpg(1, false);
            expectExactDocument(
                document,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 10, startAt: 1, endAt: 2, title: 'FIRST' }),
                    xmltvProgramme({ channelId: 10, startAt: 2, endAt: 3, title: 'SECOND' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 3.14',
        file,
        'does not impose a secondary order on equal-start programmes',
        'reversing equal-start DB rows reverses their public order',
        async () => {
            const first = makeProgram({
                id: 1,
                name: 'FIRST-TIE',
                startAt: 1,
                endAt: 2,
                description: null,
                extended: null,
            });
            const second = makeProgram({
                id: 2,
                name: 'SECOND-TIE',
                startAt: 1,
                endAt: 3,
                description: null,
                extended: null,
            });
            const model = (programs: Record<string, any>[]) =>
                makeModel({
                    channelDB: { findAll: async () => [makeChannel()] },
                    programDB: { findSchedule: async () => programs },
                }).model.getEpg(1, false);
            const forward = await model([first, second]);
            const reverse = await model([second, first]);
            const firstElement = xmltvProgramme({ channelId: 10, startAt: 1, endAt: 2, title: 'FIRST-TIE' });
            const secondElement = xmltvProgramme({ channelId: 10, startAt: 1, endAt: 3, title: 'SECOND-TIE' });
            const channel = xmltvChannel({ id: 10, displayName: '通常局' });
            expectExactDocument(forward, xmltvDocument(channel, firstElement, secondElement));
            expectExactDocument(reverse, xmltvDocument(channel, secondElement, firstElement));
        },
    ),
    defineCanonicalContract(
        'Requirement 3.15',
        file,
        'returns the exact empty XMLTV document',
        'the empty public document has no channel/programme and no trailing newline',
        async () => {
            const document = await makeModel().model.getEpg(0, false);
            expect(Buffer.from(document, 'utf8')).toEqual(Buffer.from(emptyDocument, 'utf8'));
            expect(document).not.toContain('<channel ');
            expect(document).not.toContain('<programme ');
            expect(document.endsWith('\n')).toBe(false);
        },
    ),
];
