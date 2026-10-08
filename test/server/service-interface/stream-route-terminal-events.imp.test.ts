import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiled, modelContainer, require } from './_harness';
import { streamRouteCases } from './route-contracts';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * 配信 route は、配信 stream が `exit` または `error` を出したときも、`close` と同じく
 * response を 1 回だけ終端する。keep timer は request の close まで残り、その close で止まる。
 */
describe('stream route terminal events (unittest/imp)', () => {
    describe.each(['exit', 'error'] as const)('stream %s', event => {
        it.each(streamRouteCases)(`[SI-2.8] GET /$file ends the response once on stream ${event}`, async contract => {
            vi.useFakeTimers();
            const stream = Object.assign(new EventEmitter(), { pipe: vi.fn() });
            const start = vi.fn().mockResolvedValue({ stream, streamId: 91 });
            const keep = vi.fn();
            const stop = vi.fn().mockResolvedValue(undefined);
            vi.spyOn(modelContainer, 'get').mockReturnValue({ [contract.ownerMethod]: start, keep, stop });
            const request = Object.assign(new EventEmitter(), structuredClone(contract.request));
            const response = { end: vi.fn(), header: vi.fn(), json: vi.fn(), setHeader: vi.fn(), status: vi.fn() };
            const route = require(compiled('model', 'service', 'api', `${contract.file}.js`)) as Record<string, any>;

            await route.get(request, response);
            expect(response.end).not.toHaveBeenCalled();

            stream.emit(event, event === 'error' ? new Error('synthetic stream error') : undefined);

            expect(response.end).toHaveBeenCalledOnce();
            expect(stop).not.toHaveBeenCalled();
            request.emit('close');
            await Promise.resolve();
            await Promise.resolve();
            expect(stop).toHaveBeenCalledExactlyOnceWith(91, true);
            expect(vi.getTimerCount()).toBe(0);
        });
    });
});
