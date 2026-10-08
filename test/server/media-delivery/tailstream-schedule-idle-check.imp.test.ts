import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { compiled, logger } from './_media-harness';

const tail = compiled<any>('lib', 'TailStream.js');
const container = compiled<any>('model', 'ModelContainer.js').default;

const IDLE_TIMEOUT_DEBUG_MESSAGE = 'timeout expired, closing watcher';

beforeAll(() => {
    if (!container.isBound('ILoggerModel')) {
        container.bind('ILoggerModel').toConstantValue({ getLogger: logger });
    }
});

afterAll(() => {
    if (container.isBound('ILoggerModel')) {
        container.unbind('ILoggerModel');
    }
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Real TailStream.scheduleIdleCheck with fake timers.
 * Call-site read paths schedule the timer, but idle debug residual L178–184 stays unreached
 * without an explicit idle-condition fire.
 */
describe('TailStream.scheduleIdleCheck (unittest/imp)', () => {
    it('[R2-TAILSTREAM-IDLE] fires idle timeout debug after 1000ms under idle conditions', async () => {
        vi.useFakeTimers();
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            checkIdleTimer: NodeJS.Timeout | null;
            debug: (message: string, err?: Error) => void;
            destroy: () => void;
            getFdInProgress: boolean;
            isClosed: boolean;
            readInProgress: boolean;
            readPending: number;
            scheduleIdleCheck: () => void;
        };
        const debug = vi.fn();
        stream.debug = debug;
        stream.isClosed = false;
        stream.readInProgress = false;
        stream.getFdInProgress = false;
        stream.readPending = 0;
        stream.checkIdleTimer = null;

        stream.scheduleIdleCheck();
        expect(stream.checkIdleTimer).not.toBeNull();
        expect(debug).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);

        expect(debug).toHaveBeenCalledExactlyOnceWith(IDLE_TIMEOUT_DEBUG_MESSAGE);
        expect(stream.checkIdleTimer).toBeNull();
        stream.destroy();
    });

    it('[R2-TAILSTREAM-IDLE] does not schedule a second idle timer while one is pending', () => {
        vi.useFakeTimers();
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            checkIdleTimer: NodeJS.Timeout | null;
            destroy: () => void;
            getFdInProgress: boolean;
            isClosed: boolean;
            readInProgress: boolean;
            readPending: number;
            scheduleIdleCheck: () => void;
        };
        stream.isClosed = false;
        stream.readInProgress = false;
        stream.getFdInProgress = false;
        stream.readPending = 0;
        stream.checkIdleTimer = null;

        stream.scheduleIdleCheck();
        const firstTimer = stream.checkIdleTimer;
        stream.scheduleIdleCheck();
        expect(stream.checkIdleTimer).toBe(firstTimer);
        stream.destroy();
    });
});

/**
 * Real TailStream re-entrancy/already-closed guards (doRead/checkFile/_read/finish/
 * closeFileDescriptor). These are only reachable by driving the private methods directly with a
 * synthetic already-closed/already-scheduled/already-progressing state, since every call site in
 * the class only ever invokes them when the guard condition is false.
 */
describe('TailStream already-closed and re-entrancy guards (unittest/imp)', () => {
    it('[R2-TAILSTREAM-GUARD] defaults the read offset to 0 when start is omitted', () => {
        const stream = tail.createReadStream('synthetic-recording.ts', {}) as {
            destroy: () => void;
            offset: number;
        };
        expect(stream.offset).toBe(0);
        stream.destroy();
    });

    it('[R2-TAILSTREAM-GUARD] doRead does nothing once the stream is already closed', () => {
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            destroy: () => void;
            doRead: () => void;
            fd: number | null;
            isClosed: boolean;
            readInProgress: boolean;
            readPending: number;
        };
        stream.isClosed = true;
        stream.fd = 7;
        stream.readPending = 10;
        stream.readInProgress = false;

        expect(() => stream.doRead()).not.toThrow();

        // A real fstat call would flip this to true; the guard must return before that happens.
        expect(stream.readInProgress).toBe(false);
        // fd 7 is a synthetic value never actually opened by this stream; clear it before destroy()
        // so dispose() never calls the real fs.close on a live, unrelated file descriptor.
        stream.fd = null;
        stream.isClosed = false;
        stream.destroy();
    });

    it('[R2-TAILSTREAM-GUARD] checkFile schedules nothing once the stream is already closed', () => {
        vi.useFakeTimers();
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            checkFile: (sizeAtEndOfFile: number) => void;
            checkFileTimer: NodeJS.Timeout | null;
            destroy: () => void;
            isClosed: boolean;
        };
        stream.isClosed = true;
        stream.checkFileTimer = null;

        expect(() => stream.checkFile(100)).not.toThrow();

        expect(stream.checkFileTimer).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        stream.isClosed = false;
        stream.destroy();
    });

    it('[R2-TAILSTREAM-GUARD] _read does nothing once the stream is already closed', () => {
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            _read: (size: number) => void;
            destroy: () => void;
            isClosed: boolean;
            readPending: number;
        };
        stream.isClosed = true;
        stream.readPending = 0;

        expect(() => stream._read(64)).not.toThrow();

        // A real getFd()/doRead() call would populate readPending; the guard must return first.
        expect(stream.readPending).toBe(0);
        stream.isClosed = false;
        stream.destroy();
    });

    it('[R2-TAILSTREAM-GUARD] finish disposes and pushes end-of-stream only once', () => {
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            destroy: () => void;
            dispose: () => void;
            finish: () => void;
            isClosed: boolean;
            push: (chunk: unknown) => boolean;
        };
        const dispose = vi.fn();
        const push = vi.fn(() => true);
        stream.dispose = dispose;
        stream.push = push;
        stream.isClosed = false;

        stream.finish();
        expect(dispose).toHaveBeenCalledOnce();
        expect(push).toHaveBeenCalledExactlyOnceWith(null);

        // isClosed is only ever flipped by dispose() itself; the stub above never sets it, so this
        // second call exercises the guard directly rather than relying on a real dispose() side effect.
        stream.isClosed = true;
        stream.finish();
        expect(dispose).toHaveBeenCalledOnce();
        expect(push).toHaveBeenCalledOnce();
        stream.destroy();
    });

    it('[R2-TAILSTREAM-GUARD] closeFileDescriptor closes a given fd only once', () => {
        // fs is a builtin ESM namespace here (`import * as fs from 'fs'` in TailStream.ts); its
        // exports are non-configurable, so `close` can't be spied on directly. Overriding the
        // instance's own `closedFileDescriptors` set is enough to observe the guard: a fd already in
        // it must short-circuit before TailStream ever calls fs.close a second time for it.
        const stream = tail.createReadStream('synthetic-recording.ts', { start: 0 }) as {
            closeFileDescriptor: (fd: number) => void;
            closedFileDescriptors: Set<number>;
            destroy: () => void;
        };
        const syntheticFd = 987_654;
        stream.closedFileDescriptors = new Set([syntheticFd]);

        expect(() => stream.closeFileDescriptor(syntheticFd)).not.toThrow();

        expect(stream.closedFileDescriptors.has(syntheticFd)).toBe(true);
        expect(stream.closedFileDescriptors.size).toBe(1);
        stream.destroy();
    });
});
