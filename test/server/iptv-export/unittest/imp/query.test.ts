import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { loadModule, makeResponse } from '../../_harness';

describe('IPTV handler query conversion', () => {
    it.each([
        [3, 3],
        [-2, -2],
        [999, 999],
    ])('[Task 1.1] preserves the OpenAPI-coerced integer %i without extra validation', async (input, expected) => {
        const container = loadModule<any>('model', 'ModelContainer.js').default;
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const model = { getEpg: vi.fn(async () => '<synthetic/>') };
        container.bind('IIPTVApiModel').toConstantValue(model);
        try {
            await handler({ query: { days: input, isHalfWidth: true } }, makeResponse());
            expect(model.getEpg).toHaveBeenCalledWith(expected, true);
        } finally {
            container.unbind('IIPTVApiModel');
        }
    });

    it.each([
        ['omitted days after the declared default', 3, true],
        ['an integer day count with normal notation', 1, false],
        ['zero days', 0, false],
        ['a positive decimal already floored by the coercer', 1, true],
        ['a negative decimal already floored by the coercer', -2, false],
    ])('[Task 8.2] passes %s through the XMLTV handler unchanged', async (_label, days, isHalfWidth) => {
        const container = loadModule<any>('model', 'ModelContainer.js').default;
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const model = { getEpg: vi.fn(async () => '<synthetic/>') };
        container.bind('IIPTVApiModel').toConstantValue(model);
        try {
            await handler({ query: { days, isHalfWidth } }, makeResponse());
            expect(model.getEpg).toHaveBeenCalledExactlyOnceWith(days, isHalfWidth);
        } finally {
            container.unbind('IIPTVApiModel');
        }
    });

    it.each([
        ['an integer mode', 7, true],
        ['omitted notation after the declared default', 2, true],
        ['zero', 0, false],
        ['a negative decimal already floored by the coercer', -1, false],
        ['a large integer', 999, false],
    ])('[Task 8.2] passes %s through the M3U8 handler unchanged', async (_label, mode, isHalfWidth) => {
        const container = loadModule<any>('model', 'ModelContainer.js').default;
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
        const getChannelList = vi.fn(async () => '#EXTM3U\n');
        container.bind('IIPTVApiModel').toConstantValue({ getChannelList });
        container.bind('IConfiguration').toConstantValue({ getConfig: () => ({}) });
        try {
            await handler(
                {
                    header: () => undefined,
                    headers: { host: 'synthetic.invalid' },
                    protocol: 'http',
                    query: { mode, isHalfWidth },
                },
                makeResponse(),
            );
            expect(getChannelList).toHaveBeenCalledExactlyOnceWith({
                isHalfWidth,
                mode,
                publicUrls: expect.any(Object),
            });
        } finally {
            container.unbind('IConfiguration');
            container.unbind('IIPTVApiModel');
        }
    });

    it('[Task 8.2] declares the omitted-query defaults the handlers rely on in the shared parameters', () => {
        const apiDoc = loadYaml(readFileSync('api.yml', 'utf8')) as any;
        const parameters = apiDoc.components.parameters;
        expect(parameters.IPTVDays.schema).toEqual({ type: 'integer', default: 3 });
        expect(parameters.IPTVIsHalfWidth.schema).toEqual({ type: 'boolean', default: true });
        expect(parameters.StreamMode.schema).toEqual({ type: 'integer' });
        const refs = (operation: any) => operation.apiDoc.parameters.map((parameter: any) => parameter.$ref);
        expect(refs(loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get)).toEqual([
            '#/components/parameters/IPTVIsHalfWidth',
            '#/components/parameters/IPTVDays',
        ]);
        expect(refs(loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get)).toEqual([
            '#/components/parameters/IPTVIsHalfWidth',
            '#/components/parameters/StreamMode',
        ]);
    });

    it.each([1e21, -1e21, Number.MAX_SAFE_INTEGER])(
        '[Task 1.1] preserves a coerced integer %s that parseInt would truncate for days',
        async input => {
            const container = loadModule<any>('model', 'ModelContainer.js').default;
            const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
            const model = { getEpg: vi.fn(async () => '<synthetic/>') };
            container.bind('IIPTVApiModel').toConstantValue(model);
            try {
                await handler({ query: { days: input, isHalfWidth: true } }, makeResponse());
                expect(model.getEpg).toHaveBeenCalledWith(input, true);
            } finally {
                container.unbind('IIPTVApiModel');
            }
        },
    );

    it.each([1e21, -1e21, Number.MAX_SAFE_INTEGER])(
        '[Task 1.1] preserves a coerced integer %s that parseInt would truncate for mode',
        async input => {
            const container = loadModule<any>('model', 'ModelContainer.js').default;
            const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
            const model = { getChannelList: vi.fn(async () => '#EXTM3U\n') };
            container.bind('IIPTVApiModel').toConstantValue(model);
            container.bind('IConfiguration').toConstantValue({ getConfig: () => ({}) });
            try {
                await handler(
                    {
                        header: () => undefined,
                        headers: { host: 'synthetic.invalid' },
                        protocol: 'http',
                        query: { mode: input, isHalfWidth: false },
                    },
                    makeResponse(),
                );
                expect(model.getChannelList).toHaveBeenCalledOnce();
                expect(model.getChannelList.mock.calls[0][0]).toMatchObject({ isHalfWidth: false, mode: input });
            } finally {
                container.unbind('IIPTVApiModel');
                container.unbind('IConfiguration');
            }
        },
    );
});
