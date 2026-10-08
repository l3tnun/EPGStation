import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ConnectionCheckModel = (require(join(compiledSnapshot, 'model', 'ConnectionCheckModel.js')) as any).default;
const RecordingStreamCreator = (
    require(join(compiledSnapshot, 'model', 'operator', 'recording', 'RecordingStreamCreator.js')) as any
).default;
const LiveStreamModel = (require(join(compiledSnapshot, 'model', 'service', 'stream', 'LiveStreamModel.js')) as any)
    .default;
const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const TunerHttpTransport = (
    require(join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;

type StreamKind = 'program recording' | 'service recording' | 'live';
type TerminalEvent = 'end' | 'close' | 'error';

interface StreamHarness {
    readonly acquire: (signal?: AbortSignal) => Promise<PassThrough>;
    readonly cleanup: () => Promise<void>;
    readonly emitExitStream: ReturnType<typeof vi.fn> | null;
    readonly request: ReturnType<typeof vi.fn>;
    readonly timerCount: () => number;
}

const twentyOneDays = 21 * 24 * 60 * 60 * 1000;

const createRecordingStreamCreator = (tunerServerAccess: Record<string, unknown>): any =>
    new RecordingStreamCreator(
        { getLogger: () => ({ system: { error: vi.fn() } }) },
        {
            getConfig: () => ({
                conflictPriority: 13,
                recPriority: 7,
                timeSpecifiedEndMargin: 0,
                timeSpecifiedStartMargin: 0,
            }),
        },
        tunerServerAccess,
    );

const createRecordingHarness = (
    kind: 'program recording' | 'service recording',
    outcome: PassThrough | Error,
): StreamHarness => {
    const close = vi.fn(() => {
        if (!(outcome instanceof Error)) outcome.destroy();
    });
    const openProgramStream = vi.fn(() =>
        outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ stream: outcome, close }),
    );
    const openServiceStream = vi.fn(() =>
        outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ stream: outcome, close }),
    );
    const creator = createRecordingStreamCreator({ openProgramStream, openServiceStream });
    const reserve =
        kind === 'program recording'
            ? { id: 1, programId: 200, channelId: 100, isConflict: false }
            : {
                  id: 2,
                  programId: null,
                  channelId: 101,
                  isConflict: true,
                  startAt: Date.now(),
                  endAt: Date.now() + twentyOneDays,
              };
    return {
        acquire: (signal?: AbortSignal) => creator.getStream(reserve, signal),
        cleanup: async () => {
            for (const timer of Object.values(creator.timerIndex) as NodeJS.Timeout[]) clearTimeout(timer);
            creator.timerIndex = {};
            if (!(outcome instanceof Error)) {
                outcome.removeAllListeners();
                outcome.destroy();
            }
        },
        emitExitStream: null,
        request: kind === 'program recording' ? openProgramStream : openServiceStream,
        timerCount: () => Object.keys(creator.timerIndex).length,
    };
};

const createLiveHarness = (outcome: PassThrough | Error): StreamHarness => {
    const close = vi.fn(() => {
        if (!(outcome instanceof Error)) outcome.destroy();
    });
    const openServiceStream = vi.fn(() =>
        outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ stream: outcome, close }),
    );
    const live = new LiveStreamModel(
        { getConfig: () => ({ streamingPriority: 11 }) },
        { getLogger: () => ({ stream: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } }) },
        {},
        { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
        { openServiceStream },
        { notifyClient: vi.fn() },
    ) as any;
    const exitStream = vi.fn();
    live.setOption({ channelId: 321 }, 0);
    live.setExitStream(exitStream);
    return {
        acquire: async () => {
            await live.start(1);
            return live.getStream();
        },
        cleanup: async () => {
            await live.stop();
            if (!(outcome instanceof Error)) {
                expect(close).toHaveBeenCalledTimes(1);
            }
        },
        emitExitStream: exitStream,
        request: openServiceStream,
        timerCount: () => 0,
    };
};

const createStreamHarness = (kind: StreamKind, outcome: PassThrough | Error): StreamHarness =>
    kind === 'live' ? createLiveHarness(outcome) : createRecordingHarness(kind, outcome);

const makeCheck = (checkAvailability: ReturnType<typeof vi.fn>): any =>
    new ConnectionCheckModel(
        { getLogger: () => ({ system: { info: vi.fn() } }) },
        { checkAvailability },
        { checkConnection: vi.fn() },
    );

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('tuner stream lifecycle characterization', () => {
    it.each(['program recording', 'service recording', 'live'] as const)(
        '[TA-1.4] forwards %s acquisition failure unchanged and never retries',
        async kind => {
            vi.useFakeTimers();
            const failure = new Error(`synthetic ${kind} acquisition failure`);
            const harness = createStreamHarness(kind, failure);
            try {
                await expect(harness.acquire()).rejects.toBe(failure);
                await vi.advanceTimersByTimeAsync(60_000);
                expect(harness.request).toHaveBeenCalledTimes(1);
                expect(harness.timerCount()).toBe(0);
            } finally {
                await harness.cleanup();
                vi.clearAllTimers();
            }
        },
    );

    it.each(
        (['program recording', 'service recording', 'live'] as const).flatMap(kind =>
            (['end', 'close', 'error'] as const).map(terminal => [kind, terminal] as const),
        ),
    )('[TA-1.4] transfers %s upstream %s once without retry', async (kind, terminal) => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const harness = createStreamHarness(kind, stream);
        try {
            const transferred = await harness.acquire();
            expect(transferred).toBe(stream);
            const observed = vi.fn();
            transferred.once(terminal, observed);
            if (terminal === 'error') {
                transferred.emit('error', new Error(`synthetic ${kind} upstream error`));
            } else {
                transferred.emit(terminal);
            }
            expect(observed).toHaveBeenCalledTimes(1);
            if (harness.emitExitStream !== null) expect(harness.emitExitStream).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(harness.request).toHaveBeenCalledTimes(1);
        } finally {
            await harness.cleanup();
            vi.clearAllTimers();
        }
    });

    it.each(['program recording', 'service recording', 'live'] as const)(
        '[TA-1.4] lets the consumer destroy the transferred %s Readable without retry',
        async kind => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const harness = createStreamHarness(kind, stream);
            try {
                const transferred = await harness.acquire();
                const closed = new Promise<void>(resolve => transferred.once('close', resolve));
                transferred.destroy();
                await closed;
                expect(transferred.destroyed).toBe(true);
                if (harness.emitExitStream !== null) expect(harness.emitExitStream).toHaveBeenCalledTimes(1);
                await vi.advanceTimersByTimeAsync(60_000);
                expect(harness.request).toHaveBeenCalledTimes(1);
            } finally {
                await harness.cleanup();
                vi.clearAllTimers();
            }
        },
    );

    it.each(['program recording', 'service recording', 'live'] as const)(
        '[TA-1.4] keeps an established %s Readable alive for a long fake-clock interval without retry or total deadline',
        async kind => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const harness = createStreamHarness(kind, stream);
            try {
                const transferred = await harness.acquire();
                await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000);
                expect(transferred.destroyed).toBe(false);
                expect(harness.request).toHaveBeenCalledTimes(1);
                if (harness.emitExitStream !== null) expect(harness.emitExitStream).not.toHaveBeenCalled();
                expect(harness.timerCount()).toBe(kind === 'service recording' ? 1 : 0);
            } finally {
                await harness.cleanup();
                vi.clearAllTimers();
            }
        },
    );

    it.each(['program recording', 'service recording'] as const)(
        '[TA-1.4] forwards caller cancellation signal when acquiring a %s stream',
        async kind => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const harness = createStreamHarness(kind, stream);
            const controller = new AbortController();
            try {
                await expect(harness.acquire(controller.signal)).resolves.toBe(stream);
                expect(harness.request).toHaveBeenCalledTimes(1);
                const request = harness.request.mock.calls[0][0];
                expect(request.signal).toBe(controller.signal);
                expect(request.priority).toBe(kind === 'program recording' ? 7 : 13);
            } finally {
                await harness.cleanup();
                vi.clearAllTimers();
            }
        },
    );
});

describe('tuner startup and deadline baseline', () => {
    it('[TA-1.5] leaves one pending startup availability request unbounded and does not release its barrier', async () => {
        vi.useFakeTimers();
        let settle!: () => void;
        const checkAvailability = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    settle = resolve;
                }),
        );
        const checker = makeCheck(checkAvailability);
        let barrierReleased = false;
        const barrier = checker.checkMirakurun().then(() => {
            barrierReleased = true;
        });
        try {
            await vi.advanceTimersByTimeAsync(86_400_000);
            expect(checkAvailability).toHaveBeenCalledTimes(1);
            expect(barrierReleased).toBe(false);
            settle();
            await barrier;
            expect(barrierReleased).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            settle?.();
            vi.clearAllTimers();
        }
    });

    it('[TA-1.5] waits exactly one second only after a settled failure and retries without attempt or total-wait limit', async () => {
        vi.useFakeTimers();
        const checkAvailability = vi
            .fn()
            .mockRejectedValueOnce(new Error('synthetic failure 1'))
            .mockRejectedValueOnce(new Error('synthetic failure 2'))
            .mockResolvedValueOnce({ version: 'synthetic' });
        const checker = makeCheck(checkAvailability);
        const pending = checker.checkMirakurun();
        try {
            await Promise.resolve();
            expect(checkAvailability).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(999);
            expect(checkAvailability).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(checkAvailability).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1000);
            await pending;
            expect(checkAvailability).toHaveBeenCalledTimes(3);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.clearAllTimers();
        }
    });
});

describe('tuner request deadline and resource cleanup', () => {
    it.each([
        ['status', (access: any, signal: AbortSignal) => access.getStatus({ signal })],
        ['tuners', (access: any, signal: AbortSignal) => access.getTuners({ signal })],
        ['services', (access: any, signal: AbortSignal) => access.getServices({ signal })],
        ['programs', (access: any, signal: AbortSignal) => access.getPrograms({ signal })],
        ['programs by service', (access: any, signal: AbortSignal) => access.getProgramsByService(1, { signal })],
        ['program', (access: any, signal: AbortSignal) => access.getProgram(1, { signal })],
        ['logo', (access: any, signal: AbortSignal) => access.getLogo(1, { signal })],
    ] as const)('[TA-2.4] keeps caller cancellation terminal for %s', async (_label, invoke) => {
        vi.useFakeTimers();
        let operationSignal: AbortSignal | undefined;
        const pendingRequest = vi.fn((_path: string, options?: { signal?: AbortSignal }) => {
            operationSignal = options?.signal;
            return new Promise<never>((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => reject(new Error('transport aborted')), {
                    once: true,
                });
            });
        });
        const access = new TunerServerAccessModel(
            'http://synthetic.invalid:40772',
            'epgstation/synthetic',
            { getJson: pendingRequest, getBuffer: pendingRequest },
            { tunerRestRequestTimeoutMs: 10 },
        );
        const controller = new AbortController();
        const result = invoke(access, controller.signal).catch((error: Error) => error);

        await Promise.resolve();
        controller.abort();
        await vi.advanceTimersByTimeAsync(10);
        await expect(result).resolves.toMatchObject({ message: 'Tuner request cancelled' });

        expect(operationSignal?.aborted).toBe(true);
        expect(pendingRequest).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['caller-first', 'Tuner request cancelled'],
        ['timeout-first', 'Tuner request timeout after 10ms'],
    ] as const)(
        '[TA-2.4] keeps %s terminal across the getStatus status-to-version handoff',
        async (order, expectedMessage) => {
            vi.useFakeTimers();
            let resolveVersion!: (value: unknown) => void;
            let versionSignal: AbortSignal | undefined;
            const paths: string[] = [];
            const getJson = vi.fn((path: string, options?: { signal?: AbortSignal }) => {
                paths.push(path);
                if (path === '/api/status') return Promise.resolve({});
                versionSignal = options?.signal;
                return new Promise<unknown>(resolve => {
                    resolveVersion = resolve;
                });
            });
            const access = new TunerServerAccessModel(
                'http://synthetic.invalid:40772',
                'epgstation/synthetic',
                { getJson, getBuffer: vi.fn() },
                { tunerRestRequestTimeoutMs: 10 },
            );
            const controller = new AbortController();
            const addCallerListener = vi.spyOn(controller.signal, 'addEventListener');
            const removeCallerListener = vi.spyOn(controller.signal, 'removeEventListener');
            const terminal = access.getStatus({ signal: controller.signal }).then(
                () => new Error('unexpected getStatus success'),
                (error: Error) => error,
            );

            for (let turn = 0; turn < 10 && getJson.mock.calls.length < 2; turn++) await Promise.resolve();
            expect(paths).toEqual(['/api/status', '/api/version']);
            expect(versionSignal).toBeInstanceOf(AbortSignal);
            expect(versionSignal).not.toBe(controller.signal);

            if (order === 'caller-first') {
                controller.abort();
                await vi.advanceTimersByTimeAsync(10);
            } else {
                await vi.advanceTimersByTimeAsync(10);
                controller.abort();
            }
            const firstError = await terminal;
            expect(firstError.message).toBe(expectedMessage);
            expect(versionSignal?.aborted).toBe(true);

            resolveVersion({ current: '1.0.0', latest: '1.1.0' });
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(10);

            expect(await terminal).toBe(firstError);
            expect(getJson).toHaveBeenCalledTimes(2);
            const added = addCallerListener.mock.calls.filter(([event]) => event === 'abort');
            const removed = removeCallerListener.mock.calls.filter(([event]) => event === 'abort');
            expect(added).toHaveLength(2);
            expect(removed).toHaveLength(2);
            const activeCallerListeners = added.filter(
                ([, listener]) => !removed.some(([, removedListener]) => removedListener === listener),
            );
            expect(activeCallerListeners).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('[TA-2.4] destroys the owned request and acquired response once on a network error', async () => {
        const incoming = new PassThrough();
        Object.assign(incoming, { headers: {}, statusCode: 200 });
        const responseDestroy = vi.spyOn(incoming, 'destroy');
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn(() => requestObject.emit('error', new Error('late destroy error')));
        requestObject.end = () => {
            requestCallback?.(incoming);
            queueMicrotask(() => requestObject.emit('error', new Error('synthetic network error')));
        };
        let requestCallback: ((response: PassThrough) => void) | undefined;
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            vi.fn((_options: unknown, callback: (response: PassThrough) => void) => {
                requestCallback = callback;
                return requestObject;
            }),
        );

        await expect(transport.getJson('/api/status')).rejects.toThrow('Tuner request failed');
        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
        expect(responseDestroy).toHaveBeenCalledTimes(1);
    });

    it('[TA-2.4] destroys the owned request once when request startup throws synchronously', async () => {
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        requestObject.end = () => {
            throw new Error('synthetic startup failure');
        };
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            vi.fn(() => requestObject),
        );

        await expect(transport.getJson('/api/status')).rejects.toThrow('Tuner request failed');
        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
    });

    it('[TA-2.4] preserves the stable failure when request creation throws before ownership', async () => {
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            vi.fn(() => {
                throw new Error('synthetic request creation failure');
            }),
        );

        await expect(transport.getJson('/api/status')).rejects.toThrow('Tuner request failed');
    });

    it('[TA-2.4] destroys the same late response once across duplicate callbacks', async () => {
        let deliverResponse: ((response: any) => void) | undefined;
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        requestObject.end = vi.fn();
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            vi.fn((_options: unknown, callback: (response: any) => void) => {
                deliverResponse = callback;
                return requestObject;
            }),
        );
        const controller = new AbortController();
        const pending = transport.getJson('/api/status', { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toThrow('Tuner request cancelled');
        const lateResponse = Object.assign(new EventEmitter(), {
            destroy: vi.fn(),
            destroyed: false,
        });

        deliverResponse?.(lateResponse);
        deliverResponse?.(lateResponse);

        expect(lateResponse.destroy).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['status failure', 500, '{}'],
        ['parse failure', 200, '{'],
    ] as const)('[TA-2.4] destroys request and response once on %s', async (_label, statusCode, body) => {
        const incoming = new PassThrough();
        Object.assign(incoming, { headers: {}, statusCode });
        const responseDestroy = vi.spyOn(incoming, 'destroy');
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        requestObject.end = () => {
            requestCallback?.(incoming);
            queueMicrotask(() => incoming.end(body));
        };
        let requestCallback: ((response: PassThrough) => void) | undefined;
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            vi.fn((_options: unknown, callback: (response: PassThrough) => void) => {
                requestCallback = callback;
                return requestObject;
            }),
        );

        await expect(transport.getJson('/api/status')).rejects.toThrow();
        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
        expect(responseDestroy).toHaveBeenCalledTimes(1);
    });
});

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

describe('tuner transport deadline races and listener cleanup', () => {
    it('[TA-2.4] keeps caller cancellation terminal and releases an in-flight response exactly once', async () => {
        vi.useFakeTimers();
        const incoming = new PassThrough();
        Object.assign(incoming, { headers: {}, statusCode: 200 });
        const responseDestroy = vi.spyOn(incoming, 'destroy');
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            requestObject.end = () => callback(incoming);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport, {
            tunerStreamEstablishmentTimeoutMs: 10,
        });
        const controller = new AbortController();
        const removeCallerListener = vi.spyOn(controller.signal, 'removeEventListener');

        const pending = access.openServiceStream({ serviceId: 20, priority: 11, signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toThrow(/cancelled/i);
        await vi.advanceTimersByTimeAsync(10);

        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
        expect(responseDestroy).toHaveBeenCalledTimes(1);
        expect(incoming.listenerCount('data')).toBe(0);
        expect(incoming.listenerCount('end')).toBe(0);
        expect(incoming.listenerCount('error')).toBe(0);
        expect(incoming.listenerCount('close')).toBe(0);
        expect(removeCallerListener).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-2.4] removes body collectors when a REST deadline destroys the response', async () => {
        vi.useFakeTimers();
        const incoming = new PassThrough();
        Object.assign(incoming, { headers: {}, statusCode: 200 });
        const responseDestroy = vi.spyOn(incoming, 'destroy');
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            requestObject.end = () => callback(incoming);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport, {
            tunerRestRequestTimeoutMs: 10,
        });

        const pending = access.getPrograms().catch((error: Error) => error);
        await vi.advanceTimersByTimeAsync(10);
        await expect(pending).resolves.toMatchObject({ message: expect.stringMatching(/timeout/i) });
        await Promise.resolve();

        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
        expect(responseDestroy).toHaveBeenCalledTimes(1);
        expect(incoming.listenerCount('data')).toBe(0);
        expect(incoming.listenerCount('end')).toBe(0);
        expect(incoming.listenerCount('error')).toBe(0);
        expect(incoming.listenerCount('close')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['redirect drain', 302, { location: '/api/status' }],
        ['body collection', 200, {}],
    ] as const)(
        '[TA-2.4] treats response close as terminal during %s and removes every listener',
        async (_label, status, headers) => {
            const incoming = new PassThrough();
            Object.assign(incoming, { headers, statusCode: status });
            const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
                const requestObject = new EventEmitter() as EventEmitter & { end(): void };
                requestObject.end = () => {
                    callback(incoming);
                    queueMicrotask(() => incoming.destroy());
                };
                return requestObject;
            });
            const transport = new TunerHttpTransport(
                parseConnectionTarget('http://synthetic.invalid:40772'),
                'epgstation/synthetic',
                request,
            );

            await expect(transport.getJson('/api/status')).rejects.toThrow('Tuner response failed');
            expect(incoming.listenerCount('data')).toBe(0);
            expect(incoming.listenerCount('end')).toBe(0);
            expect(incoming.listenerCount('error')).toBe(0);
            expect(incoming.listenerCount('close')).toBe(0);
        },
    );

    it('[TA-2.4] rejects an already-aborted transport request before I/O', async () => {
        const request = vi.fn();
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        const controller = new AbortController();
        controller.abort();

        await expect(transport.getJson('/api/status', { signal: controller.signal })).rejects.toThrow(
            'Tuner request cancelled',
        );
        expect(request).not.toHaveBeenCalled();
    });

    it('[TA-2.4] absorbs one late request error and removes request and signal listeners after cancellation', async () => {
        let deliverResponse: ((value: PassThrough) => void) | undefined;
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        requestObject.end = vi.fn();
        const removeRequestListener = vi.spyOn(requestObject, 'removeListener');
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            deliverResponse = callback;
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        const controller = new AbortController();
        const addSignalListener = vi.spyOn(controller.signal, 'addEventListener');
        const removeSignalListener = vi.spyOn(controller.signal, 'removeEventListener');
        const pending = transport.getJson('/api/status', { signal: controller.signal }).catch((error: Error) => error);
        controller.abort();
        await expect(pending).resolves.toMatchObject({ message: 'Tuner request cancelled' });
        expect(requestObject.listenerCount('error')).toBe(1);
        expect(() => requestObject.emit('error', new Error('SYNTHETIC_LATE_SOCKET_FAILURE'))).not.toThrow();
        expect(requestObject.listenerCount('error')).toBe(0);
        expect(requestObject.listenerCount('close')).toBe(1);
        requestObject.emit('close');
        expect(requestObject.listenerCount('error')).toBe(0);
        expect(requestObject.listenerCount('close')).toBe(0);
        const late = new PassThrough();
        Object.assign(late, { headers: {}, statusCode: 200 });
        const destroyLate = vi.spyOn(late, 'destroy');
        deliverResponse?.(late);

        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
        expect(destroyLate).toHaveBeenCalledTimes(1);
        expect(addSignalListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
        expect(removeSignalListener).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(removeSignalListener).toHaveBeenCalledTimes(1);
        expect(removeRequestListener).toHaveBeenCalledWith('error', expect.any(Function));
        expect(removeRequestListener).toHaveBeenCalledWith('close', expect.any(Function));
        expect(requestObject.listenerCount('error')).toBe(0);
        expect(requestObject.listenerCount('close')).toBe(0);
        expect(removeSignalListener).toHaveBeenCalledTimes(1);
    });

    it('[TA-2.4] keeps the raw getStream compatibility result separate from a closable handle', async () => {
        const incoming = new PassThrough();
        Object.assign(incoming, { headers: {}, statusCode: 200 });
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            const requestObject = new EventEmitter() as EventEmitter & { end(): void };
            requestObject.end = () => callback(incoming);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );

        await expect(transport.getStream('/api/services/20/stream')).resolves.toBe(incoming);
    });

    it('[TA-2.4] sanitizes a non-Error response-handler rejection', async () => {
        const incoming = new PassThrough();
        Object.assign(incoming, { headers: {}, statusCode: 200 });
        const responseDestroy = vi.spyOn(incoming, 'destroy');
        const requestObject = new EventEmitter() as EventEmitter & {
            destroy: ReturnType<typeof vi.fn>;
            end(): void;
        };
        requestObject.destroy = vi.fn();
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            requestObject.end = () => callback(incoming);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        transport.handleResponse = vi.fn(async () => Promise.reject('synthetic non-error response failure'));

        await expect(transport.getJson('/api/status')).rejects.toThrow('Tuner response failed');
        expect(requestObject.destroy).toHaveBeenCalledTimes(1);
        expect(responseDestroy).toHaveBeenCalledTimes(1);
    });

    it('[TA-2.4] accepts an options snapshot with no signal and cleans a completed request', async () => {
        const incoming = response(200);
        const requestObject = new EventEmitter() as EventEmitter & { end(): void };
        const removeRequestListener = vi.spyOn(requestObject, 'removeListener');
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            requestObject.end = () => callback(incoming);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );

        await expect(transport.getJson('/api/status', {})).resolves.toEqual({});
        expect(requestObject.listenerCount('error')).toBe(0);
        expect(requestObject.listenerCount('close')).toBe(0);
        expect(removeRequestListener).toHaveBeenCalledWith('error', expect.any(Function));
        expect(removeRequestListener).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('[TA-2.4] ignores a duplicate callback from a completed redirect hop', async () => {
        const callbacks: Array<(value: PassThrough) => void> = [];
        const requestObjects: Array<EventEmitter & { destroy: ReturnType<typeof vi.fn>; end(): void }> = [];
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            callbacks.push(callback);
            const requestObject = new EventEmitter() as EventEmitter & {
                destroy: ReturnType<typeof vi.fn>;
                end(): void;
            };
            requestObject.destroy = vi.fn();
            requestObject.end = () => {
                if (callbacks.length !== 1) return;
                const redirect = response(302);
                Object.assign(redirect, { headers: { location: '/moved/status' } });
                callback(redirect);
            };
            requestObjects.push(requestObject);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        const pending = transport.getJson('/api/status');
        await new Promise(resolve => setImmediate(resolve));
        expect(callbacks).toHaveLength(2);

        const duplicate = response(200);
        const destroyDuplicate = vi.spyOn(duplicate, 'destroy');
        callbacks[0](duplicate);
        expect(destroyDuplicate).toHaveBeenCalledTimes(1);
        expect(callbacks).toHaveLength(2);

        const finalResponse = response(200);
        callbacks[1](finalResponse);
        await expect(pending).resolves.toEqual({});
        expect(requestObjects).toHaveLength(2);
    });

    it('[TA-2.4] removes the close listener after a successful redirect drain', async () => {
        const redirect = response(302);
        Object.assign(redirect, { headers: { location: '/moved/status' } });
        const removeRedirectListener = vi.spyOn(redirect, 'removeListener');
        const finalResponse = response(200);
        const responses = [redirect, finalResponse];
        const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
            const requestObject = new EventEmitter() as EventEmitter & { end(): void };
            requestObject.end = () => callback(responses.shift()!);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );

        await expect(transport.getJson('/api/status')).resolves.toEqual({});
        expect(redirect.listenerCount('close')).toBe(0);
        expect(removeRedirectListener).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it.each([
        ['redirect drain', 302, { location: '/moved/status' }],
        ['body collection', 200, {}],
    ] as const)(
        '[TA-2.4] explicitly detaches the close listener after successful %s',
        async (_label, status, headers) => {
            const incoming = new EventEmitter() as EventEmitter & {
                headers: Record<string, string>;
                resume(): void;
                statusCode: number;
            };
            incoming.statusCode = status;
            incoming.headers = headers;
            incoming.resume = vi.fn();
            const removeListener = vi.spyOn(incoming, 'removeListener');
            const finalResponse = response(200);
            let call = 0;
            const request = vi.fn((_options: unknown, callback: (value: PassThrough) => void) => {
                const requestObject = new EventEmitter() as EventEmitter & { end(): void };
                requestObject.end = () => {
                    call++;
                    if (call === 1) {
                        callback(incoming);
                        queueMicrotask(() => {
                            if (status === 200) incoming.emit('data', Buffer.from('{}'));
                            incoming.emit('end');
                        });
                        return;
                    }
                    callback(finalResponse);
                };
                return requestObject;
            });
            const transport = new TunerHttpTransport(
                parseConnectionTarget('http://synthetic.invalid:40772'),
                'epgstation/synthetic',
                request,
            );

            await expect(transport.getJson('/api/status')).resolves.toEqual({});
            expect(removeListener.mock.calls.filter(([event]) => event === 'close')).toHaveLength(1);
            expect(incoming.listenerCount('close')).toBe(0);
        },
    );
});
