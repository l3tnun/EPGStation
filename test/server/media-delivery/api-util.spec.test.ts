import { describe, expect, it } from 'vitest';

import { compiled } from './_media-harness';

const ApiUtil = compiled<any>('model', 'api', 'ApiUtil.js').default;

describe('ApiUtil real-implementation characterization', () => {
    it.each([
        [undefined, false, 'http://receiver.invalid/api/videos/7'],
        [undefined, true, 'https://receiver.invalid/api/videos/7'],
        ['/epg', false, 'http://receiver.invalid/epg/api/videos/7'],
        ['/epg', true, 'https://receiver.invalid/epg/api/videos/7'],
    ] as const)(
        'createM3U8PlayListStr composes subDirectory=%s isSecure=%s into the exact playlist body',
        (subDirectory, isSecure, expectedUrl) => {
            const apiUtil = new ApiUtil({ getConfig: () => ({ subDirectory }) });

            const playlist = apiUtil.createM3U8PlayListStr({
                baseUrl: '/api/videos/7',
                duration: 42,
                host: 'receiver.invalid',
                isSecure,
                name: 'synthetic-title',
            });

            expect(playlist).toBe(`#EXTM3U\n#EXTINF: 42, synthetic-title\n${expectedUrl}`);
        },
    );

    it.each([
        [undefined, 'receiver.invalid', 'receiver.invalid'],
        ['/epg', 'receiver.invalid', 'receiver.invalid/epg'],
        ['epg/nested', 'receiver.invalid:8888', 'receiver.invalid:8888/epg/nested'],
    ] as const)('getHost joins subDirectory=%s onto host=%s producing %s', (subDirectory, baseHost, expectedHost) => {
        const apiUtil = new ApiUtil({ getConfig: () => ({ subDirectory }) });

        expect(apiUtil.getHost(baseHost)).toBe(expectedHost);
    });
});
