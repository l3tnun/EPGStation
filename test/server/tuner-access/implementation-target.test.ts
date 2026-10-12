import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const TunerHttpTransport = (
    require(join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;

const response = (statusCode: number, body = '{}'): PassThrough => {
    const value = new PassThrough() as PassThrough & {
        headers: Record<string, string | undefined>;
        statusCode: number;
    };
    value.statusCode = statusCode;
    value.headers = {};
    queueMicrotask(() => value.end(body));
    return value;
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('tuner access implementation targets', () => {
    it('[TA-2.1] preserves a colon inside the legacy Unix base path', () => {
        const legacyTarget = ['http:', '', 'unix:', 'tmp', 'synthetic.sock:', 'nested:variant', 'api'].join('/');
        expect(parseConnectionTarget(legacyTarget)).toEqual({
            kind: 'unix',
            socketPath: '/tmp/synthetic.sock',
            basePath: '/nested:variant/api',
        });
    });

    it('[TA-2.1] rejects a legacy Unix target with no second colon separating socket path and base path', () => {
        const legacyTarget = ['http:', '', 'unix:', 'tmp', 'synthetic.sock'].join('/');

        expect(() => parseConnectionTarget(legacyTarget)).toThrow('Invalid HTTP tuner target');
    });

    it('[TA-2.1] sanitizes request failures and removes response terminal listeners', async () => {
        const endpoint = ['192', '0', '2', '1:40772'].join('.');
        const failingRequest = vi.fn(() => {
            const request = new EventEmitter() as EventEmitter & {
                destroy: ReturnType<typeof vi.fn>;
                end(): void;
            };
            request.destroy = vi.fn();
            request.end = () => queueMicrotask(() => request.emit('error', new Error(`connect refused ${endpoint}`)));
            return request;
        });
        const failingTransport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            failingRequest,
        );

        const failure = await failingTransport.getJson('/api/status').catch((error: Error) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).not.toContain(endpoint);

        const successfulResponse = response(200);
        const removeSuccessfulResponseListener = vi.spyOn(successfulResponse, 'removeListener');
        const successfulRequest = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            const request = new EventEmitter() as EventEmitter & {
                destroy: ReturnType<typeof vi.fn>;
                end(): void;
            };
            request.destroy = vi.fn();
            request.end = () => callback(successfulResponse);
            return request;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            successfulRequest,
        );

        await expect(transport.getJson('/api/status')).resolves.toEqual({});
        expect(successfulResponse.listenerCount('data')).toBe(0);
        expect(successfulResponse.listenerCount('end')).toBe(0);
        expect(successfulResponse.listenerCount('error')).toBe(0);
        expect(successfulResponse.listenerCount('close')).toBe(0);
        expect(removeSuccessfulResponseListener).toHaveBeenCalledWith('close', expect.any(Function));
    });

    const seriesNormalizations = [
        ['Mirakurun 3.8.0', 'expiresAt', 12],
        ['mirakc 3.1.10', 'expireAt', 13],
        ['future 101.2.3', 'expiresAt', 14],
    ] as const;

    it.each(seriesNormalizations)('[TA-2.2] normalizes the %s series spelling into the owned DTO', async (_product, field, value) => {
        const common = {
            id: 1,
            eventId: 2,
            serviceId: 3,
            networkId: 4,
            startAt: 5,
            duration: 6,
            isFree: true,
        };
        const series = { id: 7, repeat: 8, pattern: 9, episode: 10, lastEpisode: 11, name: 'series' };
        const getJson = vi.fn().mockResolvedValueOnce([{ ...common, series: { ...series, [field]: value } }]);
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson,
            getBuffer: vi.fn(),
        });

        await expect(access.getPrograms()).resolves.toMatchObject([{ series: { expiresAt: value } }]);
    });

    it('[TA-2.2] requires status objects and accepts minimum and future version strings', async () => {
        for (const invalidStatus of [null, [], 'status']) {
            const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
                getJson: vi.fn(async () => invalidStatus),
                getBuffer: vi.fn(),
            });
            await expect(access.checkAvailability()).rejects.toThrow('Invalid tuner server response');
        }

        const getJson = vi
            .fn()
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ current: '3.8.0', latest: '99.0.0' })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ current: '3.1.10', latest: '100.0.0' });
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', {
            getJson,
            getBuffer: vi.fn(),
        });
        await expect(access.getStatus()).resolves.toMatchObject({ version: { current: '3.8.0', latest: '99.0.0' } });
        await expect(access.getStatus()).resolves.toMatchObject({ version: { current: '3.1.10', latest: '100.0.0' } });
    });
});
