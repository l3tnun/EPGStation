import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

export const load = <T>(...segments: string[]): T => (require(join(snapshot, ...segments)) as { default: T }).default;
export const loadModule = <T>(...segments: string[]): T => require(join(snapshot, ...segments)) as T;
export const Channel = load<new () => Record<string, any>>('db', 'entities', 'Channel.js');
export const Program = load<new () => Record<string, any>>('db', 'entities', 'Program.js');
export const IPTVApiModel = load<new (...args: any[]) => any>('model', 'api', 'iptv', 'IPTVApiModel.js');
export const ChannelDB = load<new (...args: any[]) => any>('model', 'db', 'ChannelDB.js');
export const ProgramDB = load<new (...args: any[]) => any>('model', 'db', 'ProgramDB.js');

export const logger = {
    system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
};

export const makeChannel = (overrides: Record<string, any> = {}) =>
    Object.assign(new Channel(), {
        id: 10,
        serviceId: 101,
        networkId: 1,
        name: '通常局',
        halfWidthName: 'ﾊﾝｶｸ局',
        remoteControlKeyId: 1,
        hasLogoData: true,
        channelTypeId: 0,
        channelType: 'GR',
        channel: 'synthetic-channel',
        type: 0x01,
        ...overrides,
    });

export const makeProgram = (overrides: Record<string, any> = {}) =>
    Object.assign(new Program(), {
        id: 1001,
        updateTime: 1,
        channelId: 10,
        eventId: 1,
        serviceId: 101,
        networkId: 1,
        startAt: 1_700_000_000_000,
        endAt: 1_700_003_600_000,
        duration: 3_600_000,
        isFree: true,
        name: '通常番組',
        halfWidthName: 'ﾊﾝｶｸ番組',
        shortName: 'synthetic-short',
        description: '通常説明',
        halfWidthDescription: 'ﾊﾝｶｸ説明',
        extended: '通常詳細',
        halfWidthExtended: 'ﾊﾝｶｸ詳細',
        rawExtended: null,
        rawHalfWidthExtended: null,
        channelType: 'GR',
        channel: 'synthetic-channel',
        ...overrides,
    });

export const makeModel = (overrides: Record<string, any> = {}) => {
    const channelDB = { findAll: vi.fn(async () => []), ...overrides.channelDB };
    const programDB = { findSchedule: vi.fn(async () => []), ...overrides.programDB };
    const iptvModel = new IPTVApiModel(channelDB, programDB);
    const model = new Proxy(iptvModel, {
        get: (target, property) => {
            const value = Reflect.get(target, property, target);
            if (typeof value !== 'function') return value;
            if (property !== 'getChannelList') return value.bind(target);
            return (...args: any[]) => {
                if (typeof args[0] !== 'string') return value.apply(target, args);
                return getChannelList(target, args[0], args[1], args[2], args[3], args[4]);
            };
        },
    });
    return { model, channelDB, programDB };
};

const getChannelList = (
    model: any,
    host: string,
    isSecure: boolean,
    mode: number,
    isHalfWidth: boolean,
    subDirectory?: string,
): Promise<string> => {
    const base = subDirectory === undefined ? host : `${host}${subDirectory}`;
    const scheme = isSecure ? 'https' : 'http';
    return model.getChannelList({
        isHalfWidth,
        mode,
        publicUrls: Object.freeze({
            channelLogoUrl: (channelId: number) => `${scheme}://${base}/api/channels/${channelId}/logo`,
            liveM2tsUrl: (channelId: number, streamMode: number) =>
                `${scheme}://${base}/api/streams/live/${channelId}/m2ts?mode=${streamMode}`,
        }),
    });
};

export const makeDeferred = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

export const m3uEntry = (channel: Record<string, any>, displayName: string, mode = 2): string => {
    const logo = channel.hasLogoData ? `tvg-logo="http://synthetic.invalid/api/channels/${channel.id}/logo"` : '';
    return (
        '#KODIPROP:mimetype=video/mp2t\n' +
        `#EXTINF:-1 tvg-id="${channel.id}" ${logo} group-title="${channel.channelType}",${displayName}　\n` +
        `http://synthetic.invalid/api/streams/live/${channel.id}/m2ts?mode=${mode}\n`
    );
};

export const makeResponse = () => {
    const response: Record<string, any> = Object.assign(new EventEmitter(), {
        destroyed: false,
        headers: {},
        headersSent: false,
        statusCode: undefined,
        body: undefined,
        setHeader: vi.fn((name: string, value: string) => (response.headers[name] = value)),
        status: vi.fn((value: number) => {
            response.statusCode = value;
            return response;
        }),
        end: vi.fn((value: unknown) => {
            response.body = value;
            response.headersSent = true;
            response.writableEnded = true;
            return response;
        }),
        json: vi.fn((value: unknown) => {
            response.body = value;
            response.headersSent = true;
            response.writableEnded = true;
            return response;
        }),
        writableEnded: false,
    });
    return response;
};
