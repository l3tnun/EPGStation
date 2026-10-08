import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { loadModule, makeChannel, makeModel, makeProgram } from '../../_harness';
import { registerCanonicalContracts } from './canonical-contract-case';
import { canonicalQueryCases } from './canonical-query-cases';

describe('IPTV query contract', () => {
    it('[Task 1.1] consumes OpenAPI defaults without generator-side range validation', async () => {
        const channel = makeChannel();
        const program = makeProgram();
        const channelRead = vi.fn(async () => [channel]);
        const programRead = vi.fn(async (_query: any) => [program]);
        const harness = makeModel({ channelDB: { findAll: channelRead }, programDB: { findSchedule: programRead } });
        await expect(harness.model.getChannelList('synthetic.invalid', false, 999, true)).resolves.toContain(
            'mode=999',
        );
        await harness.model.getEpg(-999, true);
        expect(programRead).toHaveBeenCalledWith(
            expect.objectContaining({
                isHalfWidth: true,
                types: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
            }),
        );
        const [{ startAt, endAt }] = programRead.mock.calls[0];
        expect(endAt - startAt).toBe(-999 * 24 * 60 * 60 * 1000);
        expect(channelRead).toHaveBeenCalledTimes(2);
    });

    it('[Task 1.1] exposes integer mode/days and boolean default-true references in OpenAPI', async () => {
        const channelApi = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js');
        const epgApi = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js');
        expect(channelApi.get.apiDoc?.parameters).toEqual([
            { $ref: '#/components/parameters/IPTVIsHalfWidth' },
            { $ref: '#/components/parameters/StreamMode' },
        ]);
        expect(epgApi.get.apiDoc?.parameters).toEqual([
            { $ref: '#/components/parameters/IPTVIsHalfWidth' },
            { $ref: '#/components/parameters/IPTVDays' },
        ]);
        const document = loadYaml(readFileSync('api.yml', 'utf8')) as any;
        expect(document.components.parameters.StreamMode.schema).toEqual({ type: 'integer' });
        expect(document.components.parameters.IPTVDays.schema).toEqual({ type: 'integer', default: 3 });
        expect(document.components.parameters.IPTVIsHalfWidth.schema).toEqual({ type: 'boolean', default: true });
    });

});

registerCanonicalContracts(canonicalQueryCases);
