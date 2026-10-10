import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

interface ChannelUtilModule {
    isMediaService: (serviceType: number) => boolean;
}

async function loadChannelUtil(): Promise<ChannelUtilModule> {
    const moduleUrl = pathToFileURL(join(compiledSnapshot!, 'util', 'ChannelUtil.js'));
    const { default: ChannelUtil } = (await import(moduleUrl.href)) as { default: ChannelUtilModule };
    return ChannelUtil;
}

describe('[IMP-CHAR-SF-3] ChannelUtil.isMediaService', () => {
    it.each([0x01, 0x02, 0xa1, 0xa2, 0xa5, 0xa6, 0xad])(
        'returns true for the video/audio service type 0x%s',
        async type => {
            const ChannelUtil = await loadChannelUtil();

            expect(ChannelUtil.isMediaService(type)).toBe(true);
        },
    );

    it.each([0x00, 0x03, 0xa0, 0xa3, 0xa4, 0xa7, 0xac, 0xae, 0xc0, 0xff])(
        'returns exactly false for the other service type %i',
        async type => {
            const ChannelUtil = await loadChannelUtil();

            expect(ChannelUtil.isMediaService(type)).toBe(false);
        },
    );
});
