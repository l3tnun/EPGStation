import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModule, makeChannel, makeDeferred, makeModel, makeProgram, makeResponse } from '../../_harness';

const container = () => loadModule<any>('model', 'ModelContainer.js').default;

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const binding of ['IIPTVApiModel', 'IConfiguration']) {
        if (container().isBound(binding)) container().unbind(binding);
    }
});

describe('IPTV request completion isolation', () => {
    it('[Task 1.2] keeps concurrent request settlements independent', async () => {
        let resolveFirst!: (value: any[]) => void;
        const first = new Promise<any[]>(resolve => (resolveFirst = resolve));
        const firstChannel = makeChannel({ id: 11, name: '先行要求局' });
        const secondChannel = makeChannel({ id: 22, name: '後続要求局' });
        const channelDB = { findAll: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce([secondChannel]) };
        const harness = makeModel({ channelDB });
        const pending = harness.model.getChannelList('synthetic.invalid', false, 1, false);
        const second = await harness.model.getChannelList('synthetic.invalid', false, 2, false);
        expect(second).toContain('tvg-id="22"');
        expect(second).not.toContain('tvg-id="11"');

        resolveFirst([firstChannel]);
        const firstResult = await pending;
        expect(firstResult).toContain('tvg-id="11"');
        expect(firstResult).not.toContain('tvg-id="22"');
        expect(channelDB.findAll).toHaveBeenCalledTimes(2);
    });

    it('[Task 1.2] settles a later M3U8 rejection before an earlier success without sharing failure', async () => {
        let resolveFirst!: (value: any[]) => void;
        const first = new Promise<any[]>(resolve => (resolveFirst = resolve));
        const failure = new Error('synthetic concurrent M3U8 failure');
        const firstChannel = makeChannel({ id: 11, name: '先行要求局' });
        const channelDB = { findAll: vi.fn().mockReturnValueOnce(first).mockRejectedValueOnce(failure) };
        const harness = makeModel({ channelDB });

        const firstRequest = harness.model.getChannelList('synthetic.invalid', false, 1, false);
        const secondRequest = harness.model.getChannelList('synthetic.invalid', false, 2, false);
        await expect(secondRequest).rejects.toBe(failure);

        resolveFirst([firstChannel]);
        const firstResult = await firstRequest;
        expect(firstResult).toContain('tvg-id="11"');
        expect(firstResult).toContain('mode=1');
        expect(channelDB.findAll).toHaveBeenCalledTimes(2);
    });

    it('[Task 1.2] keeps concurrent XMLTV programme snapshots independent', async () => {
        let resolveFirst!: (value: any[]) => void;
        const first = new Promise<any[]>(resolve => (resolveFirst = resolve));
        const firstProgram = makeProgram({ id: 101, channelId: 11, name: '先行要求番組' });
        const secondProgram = makeProgram({ id: 202, channelId: 22, name: '後続要求番組' });
        const channels = [makeChannel({ id: 11 }), makeChannel({ id: 22 })];
        const programDB = { findSchedule: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce([secondProgram]) };
        const channelDB = { findAll: vi.fn(async () => channels) };
        const harness = makeModel({ channelDB, programDB });

        const pending = harness.model.getEpg(1, false);
        const second = await harness.model.getEpg(2, false);
        expect(second).toContain('後続要求番組');
        expect(second).not.toContain('先行要求番組');

        resolveFirst([firstProgram]);
        const firstResult = await pending;
        expect(firstResult).toContain('先行要求番組');
        expect(firstResult).not.toContain('後続要求番組');
        expect(programDB.findSchedule).toHaveBeenCalledTimes(2);
        expect(channelDB.findAll).toHaveBeenCalledTimes(2);
    });

    it('[Task 1.2] settles a later XMLTV rejection before an earlier success without sharing failure', async () => {
        let resolveFirstPrograms!: (value: any[]) => void;
        const firstPrograms = new Promise<any[]>(resolve => (resolveFirstPrograms = resolve));
        const firstProgram = makeProgram({ id: 101, channelId: 11, name: '先行要求番組' });
        const secondProgram = makeProgram({ id: 202, channelId: 22, name: '後続要求番組' });
        const firstChannel = makeChannel({ id: 11, name: '先行要求局' });
        const failure = new Error('synthetic concurrent XMLTV channel failure');
        const programDB = {
            findSchedule: vi.fn().mockReturnValueOnce(firstPrograms).mockResolvedValueOnce([secondProgram]),
        };
        const channelDB = {
            findAll: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce([firstChannel]),
        };
        const harness = makeModel({ channelDB, programDB });

        const firstRequest = harness.model.getEpg(1, false);
        const secondRequest = harness.model.getEpg(2, false);
        await expect(secondRequest).rejects.toBe(failure);

        resolveFirstPrograms([firstProgram]);
        const firstResult = await firstRequest;
        expect(firstResult).toContain('先行要求番組');
        expect(firstResult).not.toContain('後続要求番組');
        expect(programDB.findSchedule).toHaveBeenCalledTimes(2);
        expect(channelDB.findAll).toHaveBeenCalledTimes(2);
    });

    it('[Task 6.1] supervises the request context once after each XMLTV DB read', async () => {
        const channel = makeChannel();
        const program = makeProgram({ name: '要求監視番組' });
        const callOrder: string[] = [];
        const programDB = {
            findSchedule: vi.fn(async () => {
                callOrder.push('programDB.findSchedule');
                return [program];
            }),
        };
        const channelDB = {
            findAll: vi.fn(async () => {
                callOrder.push('channelDB.findAll');
                return [channel];
            }),
        };
        const harness = makeModel({ channelDB, programDB });
        const ensureActive = vi.fn(() => callOrder.push('ensureActive'));
        const requestContext = { ensureActive };

        const result = await harness.model.getEpgForRequest(1, false, requestContext);

        expect(result).toContain('要求監視番組');
        expect(ensureActive).toHaveBeenCalledTimes(2);
        expect(callOrder).toEqual(['programDB.findSchedule', 'ensureActive', 'channelDB.findAll', 'ensureActive']);
    });
});

describe('IPTV HTTP completion guard', () => {
    const completeRequest = () =>
        loadModule<any>('model', 'api', 'iptv', 'IptvDocumentRequestGuard.js').completeIptvDocumentRequest;

    const startM3uRequest = (model: Record<string, any>) => {
        container().bind('IIPTVApiModel').toConstantValue(model);
        container()
            .bind('IConfiguration')
            .toConstantValue({ getConfig: () => ({}) });
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'channel.m3u8.js').get;
        const response = makeResponse();
        const pending = handler(
            {
                header: () => undefined,
                headers: { host: 'synthetic.invalid' },
                protocol: 'http',
                query: { mode: 2, isHalfWidth: false },
            },
            response,
        );
        return { pending, response };
    };

    it('[Task 6.3 mutation] converts a non-Error XMLTV rejection to one HTTP failure', async () => {
        vi.useFakeTimers();
        const getEpgForRequest = vi.fn(() => Promise.reject(undefined));
        container().bind('IIPTVApiModel').toConstantValue({ getEpgForRequest });
        const handler = loadModule<any>('model', 'service', 'api', 'iptv', 'epg.xml.js').get;
        const response = makeResponse();

        await expect(
            handler(
                {
                    query: { days: 1, isHalfWidth: false },
                },
                response,
            ),
        ).resolves.toBeUndefined();

        expect(getEpgForRequest).toHaveBeenCalledOnce();
        expect(response.statusCode).toBe(500);
        expect(response.json).toHaveBeenCalledOnce();
        expect(response.end).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.1] rejects an exact-deadline success even before the timer callback runs', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(30_000);
        const request = startM3uRequest({
            getChannelList: vi.fn(async () => '#EXTM3U\n'),
            getEpg: vi.fn(),
        });

        await request.pending;

        expect(request.response.statusCode).toBe(500);
        expect(request.response.json).toHaveBeenCalledOnce();
        expect(request.response.end).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(request.response.listenerCount('close')).toBe(0);
    });

    it('[Task 6.1] removes its timer and close listener on disconnect and observes a late rejection', async () => {
        vi.useFakeTimers();
        const document = makeDeferred<string>();
        const request = startM3uRequest({
            getChannelList: vi.fn(() => document.promise),
            getEpg: vi.fn(),
        });

        expect(vi.getTimerCount()).toBe(1);
        expect(request.response.listenerCount('close')).toBe(1);
        request.response.destroyed = true;
        request.response.emit('close');
        await request.pending;

        expect(vi.getTimerCount()).toBe(0);
        expect(request.response.listenerCount('close')).toBe(0);
        expect(request.response.end).not.toHaveBeenCalled();
        expect(request.response.json).not.toHaveBeenCalled();

        document.reject(new Error('synthetic late rejection'));
        await Promise.resolve();
        await Promise.resolve();
        expect(request.response.end).not.toHaveBeenCalled();
        expect(request.response.json).not.toHaveBeenCalled();
    });

    it('[Task 6.1] times out one pending request without affecting a later successful request', async () => {
        vi.useFakeTimers();
        const firstDocument = makeDeferred<string>();
        const getChannelList = vi.fn().mockReturnValueOnce(firstDocument.promise).mockResolvedValueOnce('#EXTM3U\n');
        const first = startM3uRequest({ getChannelList, getEpg: vi.fn() });
        container().unbind('IIPTVApiModel');
        container().unbind('IConfiguration');
        const second = startM3uRequest({ getChannelList, getEpg: vi.fn() });

        await second.pending;
        expect(second.response.statusCode).toBe(200);
        expect(second.response.body).toBe('#EXTM3U\n');

        await vi.advanceTimersByTimeAsync(30_000);
        expect(first.response.statusCode).toBe(500);

        await first.pending;

        expect(first.response.json).toHaveBeenCalledOnce();
        expect(first.response.end).not.toHaveBeenCalled();

        firstDocument.resolve('#EXTM3U\n#synthetic-late\n');
        await Promise.resolve();
        expect(first.response.json).toHaveBeenCalledOnce();
        expect(first.response.end).not.toHaveBeenCalled();
        expect(getChannelList).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['destroyed', { destroyed: true }],
        ['already ended', { writableEnded: true }],
    ])('[Task 6.1] does not start work for an $0 response', async (_label, terminalState) => {
        vi.useFakeTimers();
        const response = Object.assign(makeResponse(), terminalState);
        const execute = vi.fn();
        const failure = vi.fn();
        const success = vi.fn();

        await completeRequest()(response, { execute, failure, success });

        expect(execute).not.toHaveBeenCalled();
        expect(failure).not.toHaveBeenCalled();
        expect(success).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.1] rejects a deadline reached before work starts without executing it', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.performance, 'now').mockReturnValueOnce(0).mockReturnValue(30_000);
        const response = makeResponse();
        const execute = vi.fn();
        const failure = vi.fn();
        const success = vi.fn();

        await completeRequest()(response, { execute, failure, success });

        expect(execute).not.toHaveBeenCalled();
        expect(failure).toHaveBeenCalledOnce();
        expect(failure.mock.calls[0][0]).toMatchObject({ message: 'IptvDocumentRequestDeadlineExceeded' });
        expect(success).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.1] stops synchronous work at the exact deadline fence', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(30_000);
        const response = makeResponse();
        const afterFence = vi.fn();
        const failure = vi.fn();
        const success = vi.fn();
        const execute = vi.fn(({ ensureActive }: { ensureActive(): void }) => {
            ensureActive();
            afterFence();
            return 'synthetic-document';
        });

        await completeRequest()(response, { execute, failure, success });

        expect(execute).toHaveBeenCalledOnce();
        expect(afterFence).not.toHaveBeenCalled();
        expect(failure).toHaveBeenCalledOnce();
        expect(failure.mock.calls[0][0]).toMatchObject({ message: 'IptvDocumentRequestDeadlineExceeded' });
        expect(success).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.1] reports a synchronous execution failure before the deadline', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
        const response = makeResponse();
        const executionError = new Error('synthetic synchronous IPTV failure');
        const failure = vi.fn();
        const success = vi.fn();
        const execute = vi.fn(() => {
            throw executionError;
        });

        const pending = completeRequest()(response, { execute, failure, success });

        expect(failure).toHaveBeenCalledOnce();
        expect(failure).toHaveBeenCalledWith(executionError);
        await pending;
        expect(success).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.1] gives the exact deadline precedence over a synchronous execution failure', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(30_000);
        const response = makeResponse();
        const failure = vi.fn();
        const success = vi.fn();
        const execute = vi.fn(() => {
            throw new Error('synthetic synchronous IPTV failure at deadline');
        });

        await completeRequest()(response, { execute, failure, success });

        expect(failure).toHaveBeenCalledOnce();
        expect(failure.mock.calls[0][0]).toMatchObject({ message: 'IptvDocumentRequestDeadlineExceeded' });
        expect(success).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.1] gives the exact deadline precedence over an asynchronous rejection', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(30_000);
        const response = makeResponse();
        const failure = vi.fn();
        const success = vi.fn();
        const execute = vi.fn(() => Promise.reject(new Error('synthetic asynchronous IPTV failure at deadline')));

        await completeRequest()(response, { execute, failure, success });

        expect(failure).toHaveBeenCalledOnce();
        expect(failure.mock.calls[0][0]).toMatchObject({ message: 'IptvDocumentRequestDeadlineExceeded' });
        expect(success).not.toHaveBeenCalled();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[Task 6.1] throws a terminated error from ensureActive after the response closes', async () => {
        vi.useFakeTimers();
        const response = makeResponse();
        const failure = vi.fn();
        const success = vi.fn();
        let capturedEnsureActive!: () => void;
        const execute = vi.fn(({ ensureActive }: { ensureActive(): void }) => {
            capturedEnsureActive = ensureActive;
            return new Promise(() => undefined);
        });

        const completion = completeRequest()(response, { execute, failure, success });
        response.destroyed = true;
        response.emit('close');
        await completion;

        expect(() => capturedEnsureActive()).toThrowError('IptvDocumentRequestTerminated');
        expect(failure).not.toHaveBeenCalled();
        expect(success).not.toHaveBeenCalled();
    });

    it('[Task 6.1] rejects completion and releases resources when response commit throws', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
        const response = makeResponse();
        const commitError = new Error('synthetic response commit failure');
        const failure = vi.fn();
        const success = vi.fn(() => {
            throw commitError;
        });

        const completion = completeRequest()(response, {
            execute: vi.fn(() => 'synthetic-document'),
            failure,
            success,
        });
        const rejected = vi.fn();
        void completion.catch(rejected);

        await Promise.resolve();
        await Promise.resolve();
        expect(rejected).toHaveBeenCalledOnce();
        expect(rejected).toHaveBeenCalledWith(commitError);
        expect(failure).not.toHaveBeenCalled();
        expect(success).toHaveBeenCalledOnce();
        expect(response.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
