import { expect } from 'vitest';

/** 文書全体を UTF-8 の byte 列として比べる。部分一致では見落とす前後の byte と順序の差も検出する。 */
export const expectExactDocument = (actual: string, expected: string): void => {
    expect(Buffer.from(actual, 'utf8')).toEqual(Buffer.from(expected, 'utf8'));
};

/** 期待する時刻の文字列を、被検査の実装を通さず、サーバーのローカル時刻の getter と module 読込時の UTC オフセットから組み立てる。 */
export const localTimeString = (time: number): string => {
    const value = new Date(time);
    const pad = (part: number) => part.toString().padStart(2, '0');
    const offset = new Date().toString().replace(/^.*GMT([+-]\d{4}).*$/, '$1');
    return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())} ${offset}`;
};

export const m3u8Declaration = '#EXTM3U\n';

export interface ExpectedM3u8Entry {
    readonly id: number;
    readonly displayName: string;
    readonly group?: string;
    /** 省略すると logo の無い局。 */
    readonly logoUrl?: string;
    readonly liveUrl?: string;
    readonly mode?: number;
}

/** M3U8 の 1 局分の期待 byte 列。logo が無いときは属性の前後の空白が 2 つ続く。 */
export const m3u8Entry = (entry: ExpectedM3u8Entry): string => {
    const logo = entry.logoUrl === undefined ? '' : `tvg-logo="${entry.logoUrl}"`;
    const liveUrl =
        entry.liveUrl ?? `http://synthetic.invalid/api/streams/live/${entry.id}/m2ts?mode=${entry.mode ?? 2}`;
    return (
        '#KODIPROP:mimetype=video/mp2t\n' +
        `#EXTINF:-1 tvg-id="${entry.id}" ${logo} group-title="${entry.group ?? 'GR'}",${entry.displayName}　\n` +
        `${liveUrl}\n`
    );
};

export const defaultLogoUrl = (id: number): string => `http://synthetic.invalid/api/channels/${id}/logo`;

export const xmltvPreamble =
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv generator-info-name="EPGStation">';

export interface ExpectedXmltvChannel {
    readonly id: number;
    readonly displayName: string;
    readonly tp?: string;
    readonly serviceId?: number;
}

/** XMLTV の channel 要素の期待 byte 列。末尾に LF が付く。 */
export const xmltvChannel = (channel: ExpectedXmltvChannel): string =>
    `<channel id="${channel.id}" tp="${channel.tp ?? 'synthetic-channel'}">` +
    `<display-name lang="ja_JP">${channel.displayName}</display-name>` +
    `<service_id>${channel.serviceId ?? 101}</service_id></channel>\n`;

export interface ExpectedXmltvProgramme {
    readonly channelId: number;
    readonly startAt?: number;
    readonly endAt?: number;
    readonly title: string;
    /** 省略または null で desc 要素を出さない。 */
    readonly description?: string | null;
}

/** XMLTV の programme 要素の期待 byte 列。desc は 4 つの ASCII 空白の後に付く。 */
export const xmltvProgramme = (programme: ExpectedXmltvProgramme): string =>
    `<programme start="${localTimeString(programme.startAt ?? 1_700_000_000_000)}" ` +
    `stop="${localTimeString(programme.endAt ?? 1_700_003_600_000)}" channel="${programme.channelId}">` +
    `<title lang="ja_JP">${programme.title}</title>` +
    (programme.description === undefined || programme.description === null
        ? ''
        : `    <desc lang="ja_JP">${programme.description}</desc>`) +
    '</programme>';

export const xmltvDocument = (...elements: string[]): string => `${xmltvPreamble}${elements.join('')}</tv>`;
