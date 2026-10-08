import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiled, modelContainer, require } from './_harness';
import { streamRouteCases, type RequestFixture, type StreamRouteCase } from './route-contracts';

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const copy = <T>(value: T): T => structuredClone(value);

const makeRequest = (fixture: RequestFixture): EventEmitter & Record<string, any> =>
    Object.assign(new EventEmitter(), copy(fixture));

const makeResponse = (): Record<string, any> => ({
    end: vi.fn(),
    header: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn(),
});

const handler = (contract: StreamRouteCase): ((request: any, response: any) => Promise<void>) => {
    const route = require(compiled('model', 'service', 'api', `${contract.file}.js`)) as Record<string, any>;
    return route.get;
};

const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('SI-2.3 binary stream carrier lifecycle', () => {
    it.each(streamRouteCases)(
        'GET /$file passes exact input, pipes once, keeps, and stops once on request close',
        async contract => {
            vi.useFakeTimers();
            const stream = Object.assign(new EventEmitter(), { pipe: vi.fn() });
            const start = vi.fn().mockResolvedValue({ stream, streamId: 81 });
            const keep = vi.fn();
            const stop = vi.fn().mockResolvedValue(undefined);
            const owner = { [contract.ownerMethod]: start, keep, stop };
            const getOwner = vi.spyOn(modelContainer, 'get').mockReturnValue(owner);
            const request = makeRequest(contract.request);
            const response = makeResponse();

            await handler(contract)(request, response);

            expect(getOwner).toHaveBeenCalledOnce();
            expect(getOwner).toHaveBeenCalledWith('IStreamApiModel');
            expect(start).toHaveBeenCalledOnce();
            expect(start).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            expect(response.status).toHaveBeenCalledWith(200);
            expect(response.setHeader).toHaveBeenCalledWith('Content-Type', contract.contentType);
            expect(stream.pipe).toHaveBeenCalledOnce();
            expect(stream.pipe).toHaveBeenCalledWith(response);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(keep).toHaveBeenCalledOnce();
            expect(keep).toHaveBeenCalledWith(81);

            stream.emit('close');
            expect(response.end).toHaveBeenCalledOnce();
            request.emit('close');
            await flush();
            expect(stop).toHaveBeenCalledOnce();
            expect(stop).toHaveBeenCalledWith(81, true);
            await vi.advanceTimersByTimeAsync(20_000);
            expect(keep).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(streamRouteCases)(
        'GET /$file stops a late start once when request close wins the startup race',
        async contract => {
            vi.useFakeTimers();
            const stream = Object.assign(new EventEmitter(), { pipe: vi.fn() });
            const pending = deferred<{ stream: typeof stream; streamId: number }>();
            const start = vi.fn().mockReturnValue(pending.promise);
            const keep = vi.fn();
            const stop = vi.fn().mockResolvedValue(undefined);
            vi.spyOn(modelContainer, 'get').mockReturnValue({ [contract.ownerMethod]: start, keep, stop });
            const request = makeRequest(contract.request);
            const response = makeResponse();

            const invocation = handler(contract)(request, response);
            request.emit('close');
            pending.resolve({ stream, streamId: 82 });
            await invocation;
            await flush();

            expect(start).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            expect(stop).toHaveBeenCalledOnce();
            expect(stop).toHaveBeenCalledWith(82, true);
            expect(keep).not.toHaveBeenCalled();
            expect(stream.pipe).not.toHaveBeenCalled();
            expect(response.status).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(streamRouteCases)(
        'GET /$file maps startup rejection to exact 500 JSON without pipe, keep, stop, or timer',
        async contract => {
            vi.useFakeTimers();
            const start = vi.fn().mockRejectedValue(new Error(`synthetic-${contract.ownerMethod}`));
            const keep = vi.fn();
            const stop = vi.fn();
            vi.spyOn(modelContainer, 'get').mockReturnValue({ [contract.ownerMethod]: start, keep, stop });
            const request = makeRequest(contract.request);
            const response = makeResponse();

            await handler(contract)(request, response);

            expect(start).toHaveBeenCalledWith(...copy(contract.ownerArgs));
            expect(response.status).toHaveBeenCalledWith(500);
            expect(response.json).toHaveBeenCalledWith({
                code: 500,
                errors: `synthetic-${contract.ownerMethod}`,
                message: 'Internal Server Error',
            });
            expect(keep).not.toHaveBeenCalled();
            expect(stop).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each(['close', 'exit', 'error'] as const)('ends the response when the owned stream emits %s', async event => {
        vi.useFakeTimers();
        const contract = streamRouteCases[0];
        const stream = Object.assign(new EventEmitter(), { pipe: vi.fn() });
        vi.spyOn(modelContainer, 'get').mockReturnValue({
            [contract.ownerMethod]: vi.fn().mockResolvedValue({ stream, streamId: 83 }),
            keep: vi.fn(),
            stop: vi.fn(),
        });
        const response = makeResponse();

        await handler(contract)(makeRequest(contract.request), response);
        stream.emit(event, new Error('synthetic-stream-terminal'));

        expect(response.end).toHaveBeenCalledOnce();
    });
});
