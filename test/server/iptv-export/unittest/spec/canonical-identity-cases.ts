import { vi } from 'vitest';
import { makeChannel, makeModel, makeProgram } from '../../_harness';
import { defineCanonicalContract, type CanonicalContractCase } from './canonical-contract-case';
import {
    defaultLogoUrl,
    expectExactDocument,
    m3u8Declaration,
    m3u8Entry,
    xmltvChannel,
    xmltvDocument,
    xmltvProgramme,
} from './canonical-document';

const file = 'identity.spec.test.ts';

const documentsFor = async (
    m3u8Channels: Record<string, any>[],
    xmltvChannels: Record<string, any>[],
    programs: Record<string, any>[],
): Promise<{ readonly m3u8: string; readonly xmltv: string }> => {
    const findAll = vi.fn(async (configured?: boolean) => (configured === true ? m3u8Channels : xmltvChannels));
    const model = makeModel({
        channelDB: { findAll },
        programDB: { findSchedule: async () => programs },
    }).model;
    const [m3u8, xmltv] = await Promise.all([
        model.getChannelList('synthetic.invalid', false, 2, false),
        model.getEpg(1, false),
    ]);
    return { m3u8, xmltv };
};

export const canonicalIdentityCases: readonly CanonicalContractCase[] = [
    defineCanonicalContract(
        'Requirement 4.1',
        file,
        'uses the same persisted channel ID in M3U8 and XMLTV',
        'one persisted identifier is visible in both public documents',
        async () => {
            const channel = makeChannel({ id: 42 });
            const { m3u8, xmltv } = await documentsFor(
                [channel],
                [channel],
                [makeProgram({ channelId: 42, description: null, extended: null })],
            );
            expectExactDocument(
                m3u8,
                m3u8Declaration + m3u8Entry({ id: 42, displayName: '通常局', logoUrl: defaultLogoUrl(42) }),
            );
            expectExactDocument(
                xmltv,
                xmltvDocument(
                    xmltvChannel({ id: 42, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 42, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 4.2',
        file,
        'uses the emitted XMLTV channel ID for programme association',
        'the programme channel attribute equals the XMLTV channel identifier',
        async () => {
            const channel = makeChannel({ id: 42 });
            const { xmltv } = await documentsFor(
                [channel],
                [channel],
                [makeProgram({ channelId: 42, description: null, extended: null })],
            );
            expectExactDocument(
                xmltv,
                xmltvDocument(
                    xmltvChannel({ id: 42, displayName: '通常局' }),
                    xmltvProgramme({ channelId: 42, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 4.3',
        file,
        'does not substitute the display name for the channel identifier',
        'the display name remains text while persisted numeric ID owns identity fields',
        async () => {
            const channel = makeChannel({ id: 42, name: 'DISPLAY-NAME' });
            const { m3u8, xmltv } = await documentsFor(
                [channel],
                [channel],
                [makeProgram({ channelId: 42, description: null, extended: null })],
            );
            expectExactDocument(
                m3u8,
                m3u8Declaration + m3u8Entry({ id: 42, displayName: 'DISPLAY-NAME', logoUrl: defaultLogoUrl(42) }),
            );
            expectExactDocument(
                xmltv,
                xmltvDocument(
                    xmltvChannel({ id: 42, displayName: 'DISPLAY-NAME' }),
                    xmltvProgramme({ channelId: 42, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 4.4',
        file,
        'applies configured order to M3U8 and standard order to XMLTV',
        'the two public documents expose their respective independent orders',
        async () => {
            const first = makeChannel({ id: 10, name: 'TEN' });
            const second = makeChannel({ id: 20, name: 'TWENTY' });
            const { m3u8, xmltv } = await documentsFor(
                [second, first],
                [first, second],
                [
                    makeProgram({ channelId: 10, description: null, extended: null }),
                    makeProgram({ channelId: 20, description: null, extended: null }),
                ],
            );
            expectExactDocument(
                m3u8,
                m3u8Declaration +
                    m3u8Entry({ id: 20, displayName: 'TWENTY', logoUrl: defaultLogoUrl(20) }) +
                    m3u8Entry({ id: 10, displayName: 'TEN', logoUrl: defaultLogoUrl(10) }),
            );
            expectExactDocument(
                xmltv,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: 'TEN' }),
                    xmltvProgramme({ channelId: 10, title: '通常番組' }),
                    xmltvChannel({ id: 20, displayName: 'TWENTY' }),
                    xmltvProgramme({ channelId: 20, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 4.5',
        file,
        'allows common channels to have different relative order across documents',
        'the same common IDs are externally observable in different relative orders',
        async () => {
            const first = makeChannel({ id: 10, name: 'TEN' });
            const second = makeChannel({ id: 20, name: 'TWENTY' });
            const { m3u8, xmltv } = await documentsFor(
                [second, first],
                [first, second],
                [
                    makeProgram({ channelId: 10, description: null, extended: null }),
                    makeProgram({ channelId: 20, description: null, extended: null }),
                ],
            );
            expectExactDocument(
                m3u8,
                m3u8Declaration +
                    m3u8Entry({ id: 20, displayName: 'TWENTY', logoUrl: defaultLogoUrl(20) }) +
                    m3u8Entry({ id: 10, displayName: 'TEN', logoUrl: defaultLogoUrl(10) }),
            );
            expectExactDocument(
                xmltv,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: 'TEN' }),
                    xmltvProgramme({ channelId: 10, title: '通常番組' }),
                    xmltvChannel({ id: 20, displayName: 'TWENTY' }),
                    xmltvProgramme({ channelId: 20, title: '通常番組' }),
                ),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 4.6',
        file,
        'emits each XMLTV channel before its programmes',
        'each channel element precedes the programme elements that reference it',
        async () => {
            const first = makeChannel({ id: 10, name: 'TEN' });
            const second = makeChannel({ id: 20, name: 'TWENTY' });
            const { xmltv } = await documentsFor(
                [first, second],
                [first, second],
                [
                    makeProgram({ channelId: 10, description: null, extended: null }),
                    makeProgram({ channelId: 20, description: null, extended: null }),
                ],
            );
            expectExactDocument(
                xmltv,
                xmltvDocument(
                    xmltvChannel({ id: 10, displayName: 'TEN' }),
                    xmltvProgramme({ channelId: 10, title: '通常番組' }),
                    xmltvChannel({ id: 20, displayName: 'TWENTY' }),
                    xmltvProgramme({ channelId: 20, title: '通常番組' }),
                ),
            );
        },
    ),
];
