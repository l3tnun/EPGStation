import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeChannel, makeModel, makeProgram } from '../../_harness';
import { registerCanonicalContracts } from './canonical-contract-case';
import { canonicalXmltvCases } from './canonical-xmltv-cases';

afterEach(() => vi.useRealTimers());

describe('XMLTV exact document', () => {
    const moduleOffset = new Date().toString().replace(/^.*GMT([+-]\d{4}).*$/, '$1');
    const timeString = (time: number): string => {
        const value = new Date(time);
        const pad = (part: number) => part.toString().padStart(2, '0');
        return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())} ${moduleOffset}`;
    };

    it('[Task 3.1/3.2] reads the exact period and serializes every description combination as exact bytes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        const channel = makeChannel();
        const first = makeProgram({ id: 1, startAt: 1_700_000_000_000, endAt: 1_700_000_100_000 });
        const second = makeProgram({
            id: 2,
            startAt: 1_700_000_100_000,
            endAt: 1_700_000_200_000,
            name: '次番組',
            description: null,
        });
        const third = makeProgram({
            id: 3,
            startAt: 1_700_000_200_000,
            endAt: 1_700_000_300_000,
            name: '説明のみ番組',
            description: '単独説明',
            extended: null,
        });
        const fourth = makeProgram({
            id: 4,
            startAt: 1_700_000_300_000,
            endAt: 1_700_000_400_000,
            name: '説明なし番組',
            description: null,
            extended: null,
        });
        const harness = makeModel({
            channelDB: { findAll: async () => [channel] },
            programDB: { findSchedule: vi.fn(async () => [first, second, third, fourth]) },
        });
        const result = await harness.model.getEpg(2, false);
        expect(harness.programDB.findSchedule).toHaveBeenCalledWith({
            startAt: 1_700_000_000_000,
            endAt: 1_700_172_800_000,
            isHalfWidth: false,
            types: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
        });
        expect(Buffer.from(result, 'utf8')).toEqual(
            Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
                    '<tv generator-info-name="EPGStation">' +
                    '<channel id="10" tp="synthetic-channel">' +
                    '<display-name lang="ja_JP">通常局</display-name>' +
                    '<service_id>101</service_id></channel>\n' +
                    `<programme start="${timeString(first.startAt)}" stop="${timeString(first.endAt)}" channel="10">` +
                    '<title lang="ja_JP">通常番組</title>    <desc lang="ja_JP">通常説明通常詳細</desc></programme>' +
                    `<programme start="${timeString(second.startAt)}" stop="${timeString(second.endAt)}" channel="10">` +
                    '<title lang="ja_JP">次番組</title></programme>' +
                    `<programme start="${timeString(third.startAt)}" stop="${timeString(third.endAt)}" channel="10">` +
                    '<title lang="ja_JP">説明のみ番組</title>    <desc lang="ja_JP">単独説明</desc></programme>' +
                    `<programme start="${timeString(fourth.startAt)}" stop="${timeString(fourth.endAt)}" channel="10">` +
                    '<title lang="ja_JP">説明なし番組</title></programme></tv>',
                'utf8',
            ),
        );
    });

    it('[Task 3.1] returns the exact empty XMLTV document', async () => {
        const harness = makeModel();
        const result = await harness.model.getEpg(0, false);
        expect(Buffer.from(result, 'utf8')).toEqual(
            Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv generator-info-name="EPGStation"></tv>',
                'utf8',
            ),
        );
        expect(result.endsWith('\n')).toBe(false);
    });

});

registerCanonicalContracts(canonicalXmltvCases);
