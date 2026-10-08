import { describe, expect, it, vi } from 'vitest';
import { m3uEntry, makeChannel, makeModel } from '../../_harness';
import { registerCanonicalContracts } from './canonical-contract-case';
import { canonicalM3u8Cases } from './canonical-m3u8-cases';

describe('M3U8 exact document', () => {
    it('[Task 2.1] classifies every 8-bit service type and emits supported services with exact bytes', async () => {
        const supportedTypes = new Set([0x01, 0x02, 0xa1, 0xa2, 0xa5, 0xa6, 0xad]);
        const channels = Array.from({ length: 0x100 }, (_, type) =>
            makeChannel({ id: type + 1, type, hasLogoData: type % 2 === 0, name: `通常局${type}` }),
        );
        const included = channels.filter(channel => supportedTypes.has(channel.type));
        const harness = makeModel({ channelDB: { findAll: async () => channels } });
        const expected = '#EXTM3U\n' + included.map(channel => m3uEntry(channel, channel.name, 7)).join('');
        await expect(harness.model.getChannelList('synthetic.invalid', false, 7, false)).resolves.toBe(expected);
    });

    it('[Task 2.1] emits the declaration only for an empty or fully excluded snapshot', async () => {
        const harness = makeModel({ channelDB: { findAll: async () => [makeChannel({ type: 0x03 })] } });
        await expect(harness.model.getChannelList('synthetic.invalid', false, 1, false)).resolves.toBe('#EXTM3U\n');
    });

    it('[Task 2.1] serializes one logo-bearing service as exact UTF-8 bytes', async () => {
        const channel = makeChannel({
            id: 42,
            type: 0x02,
            channelType: 'BS',
            halfWidthName: 'ﾛｺﾞ有局',
            hasLogoData: true,
        });
        const harness = makeModel({ channelDB: { findAll: async () => [channel] } });

        await expect(
            harness.model.getChannelList('synthetic.invalid', true, 12, true, '/synthetic-subdir'),
        ).resolves.toBe(
            '#EXTM3U\n' +
                '#KODIPROP:mimetype=video/mp2t\n' +
                '#EXTINF:-1 tvg-id="42" tvg-logo="https://synthetic.invalid/synthetic-subdir/api/channels/42/logo" group-title="BS",ﾛｺﾞ有局　\n' +
                'https://synthetic.invalid/synthetic-subdir/api/streams/live/42/m2ts?mode=12\n',
        );
    });

    it.each([1, 2, 3, 4])(
        '[Task 5.1] serializes %i duplicate display names with suffixes 0,2,3,4 as exact bytes',
        async count => {
            const channels = Array.from({ length: count }, (_, index) =>
                makeChannel({ id: index + 1, name: '同名局', hasLogoData: index % 2 === 0 }),
            );
            const harness = makeModel({ channelDB: { findAll: async () => channels } });

            const result = await harness.model.getChannelList('synthetic.invalid', false, 2, false);

            expect(Buffer.from(result, 'utf8')).toEqual(
                Buffer.from(
                    '#EXTM3U\n' +
                        channels
                            .map((channel, index) =>
                                m3uEntry(channel, `同名局${index === 0 ? '' : ' '.repeat(index + 1)}`),
                            )
                            .join(''),
                    'utf8',
                ),
            );
        },
    );

    it('[Task 2.3] requests each logo and live URL exactly once from the typed public URL builder', async () => {
        const channel = makeChannel({ id: 42, halfWidthName: 'ﾛｺﾞ有局', hasLogoData: true, type: 0x02 });
        const channelLogoUrl = vi.fn((channelId: number) => `https://receiver.invalid/api/channels/${channelId}/logo`);
        const liveM2tsUrl = vi.fn(
            (channelId: number, mode: number) =>
                `https://receiver.invalid/api/streams/live/${channelId}/m2ts?mode=${mode}`,
        );
        const harness = makeModel({ channelDB: { findAll: async () => [channel] } });

        await expect(
            harness.model.getChannelList({
                isHalfWidth: true,
                mode: 12,
                publicUrls: Object.freeze({ channelLogoUrl, liveM2tsUrl }),
            }),
        ).resolves.toBe(
            '#EXTM3U\n' +
                '#KODIPROP:mimetype=video/mp2t\n' +
                '#EXTINF:-1 tvg-id="42" tvg-logo="https://receiver.invalid/api/channels/42/logo" group-title="GR",ﾛｺﾞ有局　\n' +
                'https://receiver.invalid/api/streams/live/42/m2ts?mode=12\n',
        );
        expect(channelLogoUrl).toHaveBeenCalledOnce();
        expect(channelLogoUrl).toHaveBeenCalledWith(42);
        expect(liveM2tsUrl).toHaveBeenCalledOnce();
        expect(liveM2tsUrl).toHaveBeenCalledWith(42, 12);
    });

    it('[Task 2.3] omits the logo builder call but retains one live URL call for a logo-less service', async () => {
        const channel = makeChannel({ hasLogoData: false });
        const channelLogoUrl = vi.fn((channelId: number) => `https://receiver.invalid/api/channels/${channelId}/logo`);
        const liveM2tsUrl = vi.fn(
            (channelId: number, mode: number) =>
                `https://receiver.invalid/api/streams/live/${channelId}/m2ts?mode=${mode}`,
        );
        const harness = makeModel({ channelDB: { findAll: async () => [channel] } });

        await expect(
            harness.model.getChannelList({
                isHalfWidth: false,
                mode: 4,
                publicUrls: Object.freeze({ channelLogoUrl, liveM2tsUrl }),
            }),
        ).resolves.toBe(
            '#EXTM3U\n' +
                '#KODIPROP:mimetype=video/mp2t\n' +
                '#EXTINF:-1 tvg-id="10"  group-title="GR",通常局　\n' +
                'https://receiver.invalid/api/streams/live/10/m2ts?mode=4\n',
        );
        expect(channelLogoUrl).not.toHaveBeenCalled();
        expect(liveM2tsUrl).toHaveBeenCalledOnce();
        expect(liveM2tsUrl).toHaveBeenCalledWith(10, 4);
    });

});

registerCanonicalContracts(canonicalM3u8Cases);
