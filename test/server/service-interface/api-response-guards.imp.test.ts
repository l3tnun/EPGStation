import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, require } from './_harness';

const api = require(compiled('model', 'service', 'api.js')) as {
    pathParam(request: unknown, name: string): string;
    responseFile(
        request: unknown,
        response: unknown,
        filePath: string,
        mime: string,
        download?: boolean,
        onTerminal?: () => Promise<void> | void,
        providerReadable?: unknown,
        isProviderTail?: boolean,
    ): void;
    responsePlayList(request: unknown, response: unknown, list: { name: string; playList: string }): void;
};

type FakeResponse = EventEmitter & Record<string, any>;
type FakeRequest = EventEmitter & Record<string, any>;

const makeResponse = (): FakeResponse => {
    const response = new EventEmitter() as FakeResponse;
    response.headers = {};
    response.destroyed = false;
    response.status = vi.fn(() => response);
    response.header = vi.fn((name: string, value: string) => {
        response.headers[name] = value;
        return response;
    });
    response.setHeader = vi.fn((name: string, value: string) => {
        response.headers[name] = value;
        return response;
    });
    response.set = vi.fn((headers: Record<string, unknown>) => {
        Object.assign(response.headers, headers);
        return response;
    });
    response.write = vi.fn();
    response.end = vi.fn();
    response.destroy = vi.fn();
    return response;
};

const makeRequest = (overrides: Record<string, unknown> = {}): FakeRequest => {
    const request = new EventEmitter() as FakeRequest;
    request.headers = {};
    request.method = 'GET';
    Object.assign(request, overrides);
    return request;
};

const makeProviderReadable = (): FakeResponse => {
    const readable = new EventEmitter() as FakeResponse;
    readable.pipe = vi.fn();
    readable.destroy = vi.fn();
    return readable;
};

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('api.pathParam and responsePlayList (unittest/imp)', () => {
    it('[R2-API-PATHPARAM] joins a wildcard array param the way Express itself renders its path', () => {
        const request = { params: { name: ['a', 'b', 'c'] } };
        expect(api.pathParam(request, 'name')).toBe('a/b/c');
    });

    it('[R2-API-PLAYLIST] uses inline disposition for a Firefox user agent', () => {
        const response = makeResponse();
        const request = makeRequest({ headers: { 'user-agent': 'Mozilla/5.0 (X11; Firefox/128.0)' } });

        api.responsePlayList(request, response, { name: 'test', playList: '#EXTM3U' });

        expect(response.headers['Content-Disposition']).toMatch(/^inline;/u);
    });
});

describe('api.responseFile HEAD requests (unittest/imp)', () => {
    let directory = '';

    afterEach(async () => {
        if (directory !== '') {
            await rm(directory, { force: true, recursive: true });
            directory = '';
        }
    });

    it('[R2-API-RESPONSEFILE-HEAD] sets Content-Length from the real file size and never pipes a tail-provided stream for a HEAD request', async () => {
        directory = await mkdtemp(join(tmpdir(), 'r2-responsefile-head-'));
        const path = join(directory, 'sample.ts');
        await writeFile(path, '0123456789');
        const response = makeResponse();
        const request = makeRequest({ method: 'HEAD' });
        const providerReadable = makeProviderReadable();

        api.responseFile(request, response, path, 'video/mp2t', false, undefined, providerReadable, true);

        // `if (providerReadable === undefined || isProviderTail === false || req.method ===
        // 'HEAD') { responseHeaders['Content-Length'] = stat.size; }` (api.ts:141): a HEAD
        // request always gets Content-Length set to the real on-disk size, even when
        // isProviderTail is true (which would otherwise suppress it for a GET). The provided
        // tail stream must never be read from or piped for a HEAD request either way.
        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.headers['Content-Length']).toBe(10);
        expect(response.end).toHaveBeenCalledOnce();
        expect(providerReadable.pipe).not.toHaveBeenCalled();
    });
});

describe('api.responseFile onTerminal-driven termination guards (unittest/imp)', () => {
    let directory = '';

    afterEach(async () => {
        if (directory !== '') {
            await rm(directory, { force: true, recursive: true });
            directory = '';
        }
    });

    const makeSampleFile = async (): Promise<string> => {
        directory = await mkdtemp(join(tmpdir(), 'r2-responsefile-onterminal-'));
        const path = join(directory, 'sample.ts');
        await writeFile(path, '0123456789');
        return path;
    };

    it('[R2-API-RESPONSEFILE-CLOSE] destroys the provided readable and finalizes exactly once even when destroy() re-enters close synchronously', async () => {
        const path = await makeSampleFile();
        const response = makeResponse();
        const request = makeRequest();
        const providerReadable = makeProviderReadable();
        // Some readables emit their own 'close' synchronously from destroy(); onRequestClose calls
        // destroyReadable() and then its own finalizeOnce() unconditionally, so a synchronous
        // destroy()->'close'->finalizeOnce reentry here makes onRequestClose's own trailing
        // finalizeOnce() call the second, guarded one -- otherwise unreached, since every listener
        // onRequestClose/finalizeOnce/onReadableError attach is a one-shot `once()`.
        providerReadable.destroy = vi.fn(() => providerReadable.emit('close'));
        const onTerminal = vi.fn(async () => undefined);

        api.responseFile(request, response, path, 'video/mp2t', false, onTerminal, providerReadable, false);
        await flush();

        request.emit('close');
        await flush();

        expect(providerReadable.destroy).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledOnce();
    });

    it('[R2-API-RESPONSEFILE-CLOSE-NULL-READABLE] finalizes a HEAD request that closes early without touching a readable', async () => {
        const path = await makeSampleFile();
        const response = makeResponse();
        const request = makeRequest({ method: 'HEAD' });
        const onTerminal = vi.fn(async () => undefined);

        // req.method === 'HEAD' makes sendResponse's own readable argument null; destroyReadable's
        // `readable === null` guard is only reached this way, since every other case in this suite
        // passes a real readable.
        api.responseFile(request, response, path, 'video/mp2t', false, onTerminal);
        await flush();

        expect(() => request.emit('close')).not.toThrow();
        await flush();

        expect(onTerminal).toHaveBeenCalledOnce();
    });

    it('[R2-API-RESPONSEFILE-STREAM-ERROR] finalizes once and destroys a non-destroyed response when the readable itself errors', async () => {
        const path = await makeSampleFile();
        const response = makeResponse();
        const request = makeRequest();
        const providerReadable = makeProviderReadable();
        const onTerminal = vi.fn(async () => undefined);

        api.responseFile(request, response, path, 'video/mp2t', false, onTerminal, providerReadable, false);
        await flush();

        providerReadable.emit('error', new Error('synthetic provider read failure'));
        await flush();

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(response.destroy).toHaveBeenCalledOnce();
    });

    it('[R2-API-RESPONSEFILE-STREAM-ERROR] does not re-destroy a response the readable error found already destroyed', async () => {
        const path = await makeSampleFile();
        const response = makeResponse();
        response.destroyed = true;
        const request = makeRequest();
        const providerReadable = makeProviderReadable();
        const onTerminal = vi.fn(async () => undefined);

        api.responseFile(request, response, path, 'video/mp2t', false, onTerminal, providerReadable, false);
        await flush();

        providerReadable.emit('error', new Error('synthetic provider read failure on an already-destroyed response'));
        await flush();

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(response.destroy).not.toHaveBeenCalled();
    });

    it('[R2-API-RESPONSEFILE-ONTERMINAL-REJECTS] swallows an onTerminal rejection without altering the HTTP outcome', async () => {
        const path = await makeSampleFile();
        const response = makeResponse();
        const request = makeRequest();
        const providerReadable = makeProviderReadable();
        const onTerminal = vi.fn(async () => {
            throw new Error('synthetic onTerminal rejection');
        });

        api.responseFile(request, response, path, 'video/mp2t', false, onTerminal, providerReadable, false);
        await flush();

        request.emit('close');
        await flush();
        await flush();

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(providerReadable.destroy).toHaveBeenCalledOnce();
    });
});
