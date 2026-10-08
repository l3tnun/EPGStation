import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { makeChannel, makeModel, makeProgram } from '../../_harness';

describe('IPTV serializer branches', () => {
    it('[Task 2.1] preserves the double ASCII space before group-title when logo is absent', async () => {
        const harness = makeModel({ channelDB: { findAll: async () => [makeChannel({ hasLogoData: false })] } });
        const result = await harness.model.getChannelList('synthetic.invalid', true, 4, true, '/synthetic-subdir');
        expect(result).toBe(
            '#EXTM3U\n#KODIPROP:mimetype=video/mp2t\n' +
                '#EXTINF:-1 tvg-id="10"  group-title="GR",ﾊﾝｶｸ局　\n' +
                'https://synthetic.invalid/synthetic-subdir/api/streams/live/10/m2ts?mode=4\n',
        );
    });

    it('[Task 2.3] places opaque typed builder results in the exact M3U8 URL slots', async () => {
        const channelLogoUrl = vi.fn(() => 'synthetic-logo-url');
        const liveM2tsUrl = vi.fn(() => 'synthetic-live-url');
        const harness = makeModel({ channelDB: { findAll: async () => [makeChannel()] } });

        await expect(
            harness.model.getChannelList({
                isHalfWidth: false,
                mode: 3,
                publicUrls: Object.freeze({ channelLogoUrl, liveM2tsUrl }),
            }),
        ).resolves.toBe(
            '#EXTM3U\n#KODIPROP:mimetype=video/mp2t\n' +
                '#EXTINF:-1 tvg-id="10" tvg-logo="synthetic-logo-url" group-title="GR",通常局　\n' +
                'synthetic-live-url\n',
        );
        expect(channelLogoUrl).toHaveBeenCalledWith(10);
        expect(liveM2tsUrl).toHaveBeenCalledWith(10, 3);
    });

    it('[Task 4.1] keeps every programme entity field unchanged across normal and half-width requests', async () => {
        const program = makeProgram({
            name: 'NORMAL<NAME>\x1a',
            halfWidthName: 'HALF<NAME>\x1a',
            description: 'NORMAL&DESCRIPTION\x1a',
            halfWidthDescription: 'HALF&DESCRIPTION\x1a',
            extended: 'NORMAL"EXTENDED"',
            halfWidthExtended: 'HALF"EXTENDED"',
        });
        const snapshot = { ...program };
        const harness = makeModel({
            channelDB: { findAll: async () => [makeChannel()] },
            programDB: { findSchedule: async () => [program] },
        });

        const normal = await harness.model.getEpg(1, false);
        const halfWidth = await harness.model.getEpg(1, true);

        expect(normal).toContain('<title lang="ja_JP">NORMAL＜NAME＞</title>');
        expect(normal).toContain('<desc lang="ja_JP">NORMAL＆DESCRIPTIONNORMAL”EXTENDED”</desc>');
        expect(halfWidth).toContain('<title lang="ja_JP">HALF＜NAME＞</title>');
        expect(halfWidth).toContain('<desc lang="ja_JP">HALF＆DESCRIPTIONHALF”EXTENDED”</desc>');
        expect({ ...program }).toEqual(snapshot);
    });

    it('[Task 8.2] emits the exact empty XMLTV document for zero programmes even when channels exist', async () => {
        const harness = makeModel({
            channelDB: { findAll: async () => [makeChannel({ id: 1 }), makeChannel({ id: 2 })] },
            programDB: { findSchedule: async () => [] },
        });

        const result = await harness.model.getEpg(1, false);

        expect(Buffer.from(result, 'utf8')).toEqual(
            Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv generator-info-name="EPGStation"></tv>',
                'utf8',
            ),
        );
    });

    it('[Task 8.2] emits no channels for programme-less or unselected channels and no entries for unsupported M3U8 services', async () => {
        const withProgramme = makeChannel({ id: 1, name: 'WITH-PROGRAMME', hasLogoData: false });
        const withoutProgramme = makeChannel({ id: 2, name: 'WITHOUT-PROGRAMME', hasLogoData: false });
        const unsupported = makeChannel({ id: 3, name: 'UNSUPPORTED-SERVICE', hasLogoData: false, type: 0x03 });
        const harness = makeModel({
            channelDB: { findAll: async () => [withProgramme, withoutProgramme, unsupported] },
            programDB: { findSchedule: async () => [makeProgram({ channelId: 1, description: null, extended: null })] },
        });

        const xmltv = await harness.model.getEpg(1, false);
        const m3u8 = await harness.model.getChannelList('synthetic.invalid', false, 2, false);

        expect(xmltv.match(/<channel /g)).toHaveLength(1);
        expect(xmltv).toContain('<channel id="1" ');
        expect(xmltv).not.toContain('WITHOUT-PROGRAMME');
        expect(m3u8.match(/tvg-id="/g)).toHaveLength(2);
        expect(m3u8).toContain('WITH-PROGRAMME');
        expect(m3u8).toContain('WITHOUT-PROGRAMME');
        expect(m3u8).not.toContain('UNSUPPORTED-SERVICE');
    });

    it.each([
        ['both description fields absent', { description: null, extended: null }, null],
        ['only the extended field present', { description: null, extended: 'EXTENDED-ONLY' }, null],
        ['only the description present', { description: 'DESCRIPTION-ONLY', extended: null }, 'DESCRIPTION-ONLY'],
    ])('[Task 8.2] serializes %s as the exact desc element or none', async (_label, fields, expectedDescription) => {
        const harness = makeModel({
            channelDB: { findAll: async () => [makeChannel()] },
            programDB: { findSchedule: async () => [makeProgram(fields)] },
        });

        const result = await harness.model.getEpg(1, false);

        if (expectedDescription === null) {
            expect(result).not.toContain('<desc');
            expect(result).toMatch(/<title lang="ja_JP">通常番組<\/title><\/programme>/);
        } else {
            expect(result).toContain(
                `<title lang="ja_JP">通常番組</title>    <desc lang="ja_JP">${expectedDescription}</desc></programme>`,
            );
        }
    });

    it('[Task 8.2] replaces each of the five reserved symbols and removes SUB in both title and description', async () => {
        const harness = makeModel({
            channelDB: { findAll: async () => [makeChannel()] },
            programDB: {
                findSchedule: async () => [
                    makeProgram({
                        name: '<a>&"b\'\x1a',
                        description: '<c>&"d\'\x1a',
                        extended: null,
                    }),
                ],
            },
        });

        const result = await harness.model.getEpg(1, false);

        expect(result).toContain('<title lang="ja_JP">＜a＞＆”b’</title>');
        expect(result).toContain('<desc lang="ja_JP">＜c＞＆”d’</desc>');
        expect(Buffer.from(result, 'utf8').includes(0x1a)).toBe(false);
    });

    it('[Task 3.2] keeps the module-load UTC offset after the process timezone changes', async () => {
        const compiled = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
        const script = [
            "require('reflect-metadata')",
            "const Model=require(process.env.IPTV_SNAPSHOT + '/model/api/iptv/IPTVApiModel.js').default",
            'const model=new Model({}, {})',
            'const before=model.getTimeStr(0)',
            "process.env.TZ='UTC'",
            'const after=model.getTimeStr(0)',
            'process.stdout.write(JSON.stringify({before,after}))',
        ].join(';');
        const { stdout } = await promisify(execFile)(process.execPath, ['-e', script], {
            env: { ...process.env, TZ: 'Etc/GMT-9', IPTV_SNAPSHOT: compiled },
        });
        expect(JSON.parse(stdout)).toEqual({
            before: '19700101090000 +0900',
            after: '19700101000000 +0900',
        });
    });
});
