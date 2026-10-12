import { expect, vi } from 'vitest';
import { ChannelDB, IPTVApiModel, logger, m3uEntry, makeChannel, makeModel } from '../../_harness';
import { defineCanonicalContract, type CanonicalContractCase } from './canonical-contract-case';
import { defaultLogoUrl, expectExactDocument, m3u8Declaration, m3u8Entry } from './canonical-document';

const file = 'm3u8.spec.test.ts';

const publicUrlOptions = {
    isHalfWidth: false,
    mode: 2,
    publicUrls: {
        channelLogoUrl: (id: number) => `http://synthetic.invalid/api/channels/${id}/logo`,
        liveM2tsUrl: (id: number, mode: number) => `http://synthetic.invalid/api/streams/live/${id}/m2ts?mode=${mode}`,
    },
};

/** 実際の ChannelDB の並べ替えを通す。DB の行は標準順（`orderBy` の結果）として渡す。 */
const makeModelWithActualChannelDB = (config: Record<string, unknown>, standardOrder: Record<string, any>[]) => {
    const getMany = vi.fn(async () => [...standardOrder]);
    const orderBy = vi.fn();
    const queryBuilder = { getMany, orderBy };
    orderBy.mockReturnValue(queryBuilder);
    const connection = {
        getRepository: vi.fn(() => ({
            createQueryBuilder: vi.fn(() => queryBuilder),
        })),
    };
    const channelDB = new ChannelDB(
        { getLogger: () => logger },
        { getConfig: () => config },
        { getConnection: async () => connection },
        { run: <T>(job: () => Promise<T>): Promise<T> => job() },
    );
    return { getMany, model: new IPTVApiModel(channelDB, {}), orderBy };
};

export const canonicalM3u8Cases: readonly CanonicalContractCase[] = [
    defineCanonicalContract(
        'Requirement 2.1',
        file,
        'starts the exact public document with the extended M3U declaration',
        'the first public document bytes are #EXTM3U and a newline',
        async () => {
            const document = await makeModel().model.getChannelList('synthetic.invalid', false, 2, false);
            expect(Buffer.from(document, 'utf8')).toEqual(Buffer.from('#EXTM3U\n', 'utf8'));
        },
    ),
    defineCanonicalContract(
        'Requirement 2.2',
        file,
        'includes exactly the seven supported media service types',
        'all supported types and no unsupported type appear as public entries',
        async () => {
            const supported = [0x01, 0x02, 0xa1, 0xa2, 0xa5, 0xa6, 0xad];
            const excluded = makeChannel({ id: 99, name: 'EXCLUDED', type: 0x03 });
            const channels = [
                ...supported.map((type, index) =>
                    makeChannel({ id: index + 1, name: `SUPPORTED-${type}`, type, hasLogoData: false }),
                ),
                excluded,
            ];
            const document = await makeModel({ channelDB: { findAll: async () => channels } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
            );
            expectExactDocument(
                document,
                m3u8Declaration +
                    supported
                        .map((type, index) => m3u8Entry({ id: index + 1, displayName: `SUPPORTED-${type}` }))
                        .join(''),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 2.3',
        file,
        'emits the persisted channel identifier as exact tvg-id bytes',
        'the persisted identifier is observable in tvg-id',
        async () => {
            const channel = makeChannel({ id: 42, hasLogoData: false });
            const document = await makeModel({ channelDB: { findAll: async () => [channel] } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
            );
            expectExactDocument(document, m3u8Declaration + m3u8Entry({ id: 42, displayName: '通常局' }));
        },
    ),
    defineCanonicalContract(
        'Requirement 2.4',
        file,
        'emits the requested channel display notation',
        'normal and half-width requests expose their selected display name',
        async () => {
            const channel = makeChannel({ name: 'NORMAL-NAME', halfWidthName: 'HALF-NAME', hasLogoData: false });
            const model = makeModel({ channelDB: { findAll: async () => [channel] } }).model;
            const [normal, half] = await Promise.all([
                model.getChannelList('synthetic.invalid', false, 2, false),
                model.getChannelList('synthetic.invalid', false, 2, true),
            ]);
            expectExactDocument(normal, m3u8Declaration + m3u8Entry({ id: 10, displayName: 'NORMAL-NAME' }));
            expectExactDocument(half, m3u8Declaration + m3u8Entry({ id: 10, displayName: 'HALF-NAME' }));
        },
    ),
    defineCanonicalContract(
        'Requirement 2.5',
        file,
        'emits the broadcast wave as group-title bytes',
        'the persisted BS wave is observable as group-title="BS"',
        async () => {
            const channel = makeChannel({ channelType: 'BS', hasLogoData: false });
            const document = await makeModel({ channelDB: { findAll: async () => [channel] } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
            );
            expectExactDocument(document, m3u8Declaration + m3u8Entry({ id: 10, displayName: '通常局', group: 'BS' }));
        },
    ),
    defineCanonicalContract(
        'Requirement 2.6',
        file,
        'emits video/mp2t for television and audio services alike',
        'both television and audio entries have the public video/mp2t declaration',
        async () => {
            const channels = [
                makeChannel({ id: 1, type: 0x01, name: 'TELEVISION-SERVICE', hasLogoData: false }),
                makeChannel({ id: 2, type: 0x02, name: 'AUDIO-SERVICE', hasLogoData: false }),
            ];
            const document = await makeModel({ channelDB: { findAll: async () => channels } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
            );
            expectExactDocument(
                document,
                m3u8Declaration +
                    m3u8Entry({ id: 1, displayName: 'TELEVISION-SERVICE' }) +
                    m3u8Entry({ id: 2, displayName: 'AUDIO-SERVICE' }),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 2.7',
        file,
        'emits the exact public logo URL for a logo-bearing channel',
        'the logo-bearing entry exposes its channel-specific logo URL',
        async () => {
            const channel = makeChannel({ id: 42, hasLogoData: true });
            const document = await makeModel({ channelDB: { findAll: async () => [channel] } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
            );
            expectExactDocument(
                document,
                m3u8Declaration + m3u8Entry({ id: 42, displayName: '通常局', logoUrl: defaultLogoUrl(42) }),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 2.8',
        file,
        'omits the logo attribute for a logo-less channel',
        'the logo-less entry has exact empty-logo spacing and no tvg-logo',
        async () => {
            const channel = makeChannel({ id: 42, hasLogoData: false });
            const document = await makeModel({ channelDB: { findAll: async () => [channel] } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
            );
            expectExactDocument(
                document,
                '#EXTM3U\n' +
                    '#KODIPROP:mimetype=video/mp2t\n' +
                    '#EXTINF:-1 tvg-id="42"  group-title="GR",通常局　\n' +
                    'http://synthetic.invalid/api/streams/live/42/m2ts?mode=2\n',
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 2.9',
        file,
        'emits the selected mode in the live viewing URL',
        'the public live URL contains the selected mode',
        async () => {
            const channel = makeChannel({ id: 42, hasLogoData: false });
            const document = await makeModel({ channelDB: { findAll: async () => [channel] } }).model.getChannelList(
                'synthetic.invalid',
                false,
                17,
                false,
            );
            expectExactDocument(document, m3u8Declaration + m3u8Entry({ id: 42, displayName: '通常局', mode: 17 }));
        },
    ),
    defineCanonicalContract(
        'Requirement 2.10',
        file,
        'emits the configured subdirectory in both public URLs',
        'the same subdirectory is observable in logo and live URLs',
        async () => {
            const channel = makeChannel({ id: 42, hasLogoData: true });
            const document = await makeModel({ channelDB: { findAll: async () => [channel] } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
                '/synthetic-subdir',
            );
            expectExactDocument(
                document,
                m3u8Declaration +
                    m3u8Entry({
                        id: 42,
                        displayName: '通常局',
                        liveUrl: 'http://synthetic.invalid/synthetic-subdir/api/streams/live/42/m2ts?mode=2',
                        logoUrl: 'http://synthetic.invalid/synthetic-subdir/api/channels/42/logo',
                    }),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 2.11',
        file,
        'adds increasing suffix spaces to duplicate display names',
        'duplicate names are externally distinguishable by 0, 2, and 3 ASCII spaces',
        async () => {
            const channels = [1, 2, 3].map(id =>
                makeChannel({ id, name: 'DUPLICATE', halfWidthName: 'DUPLICATE', hasLogoData: false }),
            );
            const document = await makeModel({ channelDB: { findAll: async () => channels } }).model.getChannelList(
                'synthetic.invalid',
                false,
                2,
                false,
            );
            expectExactDocument(
                document,
                m3u8Declaration +
                    m3u8Entry({ id: 1, displayName: 'DUPLICATE' }) +
                    m3u8Entry({ id: 2, displayName: `DUPLICATE${' '.repeat(2)}` }) +
                    m3u8Entry({ id: 3, displayName: `DUPLICATE${' '.repeat(3)}` }),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 2.12',
        file,
        'emits the configured prefix before the remaining standard order',
        'the public entry order follows the configured DB snapshot',
        async () => {
            const standardOrder = [101, 102, 103, 104].map(serviceId =>
                makeChannel({ id: serviceId - 90, serviceId, name: `SERVICE-${serviceId}`, hasLogoData: false }),
            );
            const { model, orderBy } = makeModelWithActualChannelDB({ sidOrder: [103, 101] }, standardOrder);
            const document = await model.getChannelList(publicUrlOptions);
            expect(orderBy).toHaveBeenCalledWith(
                'channel.channelTypeId, channel.remoteControlKeyId, channel.serviceId',
                'ASC',
            );
            expectExactDocument(
                document,
                m3u8Declaration +
                    m3u8Entry({ id: 13, displayName: 'SERVICE-103' }) +
                    m3u8Entry({ id: 11, displayName: 'SERVICE-101' }) +
                    m3u8Entry({ id: 12, displayName: 'SERVICE-102' }) +
                    m3u8Entry({ id: 14, displayName: 'SERVICE-104' }),
            );
        },
    ),
    defineCanonicalContract(
        'Requirement 2.13',
        file,
        'uses the channel-order snapshot when both order settings exist',
        'the channel-order result is the public M3U8 order',
        async () => {
            const channels = [
                makeChannel({ id: 10, serviceId: 101, name: 'TEN', hasLogoData: false }),
                makeChannel({ id: 20, serviceId: 102, name: 'TWENTY', hasLogoData: false }),
                makeChannel({ id: 30, serviceId: 103, name: 'THIRTY', hasLogoData: false }),
            ];
            const { model, getMany } = makeModelWithActualChannelDB({ channelOrder: [20], sidOrder: [101] }, channels);
            const document = await model.getChannelList(publicUrlOptions);

            expectExactDocument(
                document,
                m3u8Declaration +
                    m3u8Entry({ id: 20, displayName: 'TWENTY' }) +
                    m3u8Entry({ id: 10, displayName: 'TEN' }) +
                    m3u8Entry({ id: 30, displayName: 'THIRTY' }),
            );
            expect(getMany).toHaveBeenCalledOnce();
        },
    ),
    defineCanonicalContract(
        'Requirement 2.14',
        file,
        'returns only the declaration for an empty channel snapshot',
        'the empty public document is exactly #EXTM3U and one newline',
        async () => {
            const document = await makeModel().model.getChannelList('synthetic.invalid', false, 2, false);
            expect(Buffer.from(document, 'utf8')).toEqual(Buffer.from('#EXTM3U\n', 'utf8'));
        },
    ),
    defineCanonicalContract(
        'Requirement 2.15',
        file,
        'generates the document without starting live media delivery',
        'document bytes complete using only one channel read and no stream dependency',
        async () => {
            const channel = makeChannel();
            const channelRead = vi.fn(async () => [channel]);
            const model = makeModel({ channelDB: { findAll: channelRead } }).model;
            await expect(model.getChannelList('synthetic.invalid', false, 2, false)).resolves.toBe(
                '#EXTM3U\n' + m3uEntry(channel, channel.name, 2),
            );
            expect(channelRead).toHaveBeenCalledOnce();
        },
    ),
];
