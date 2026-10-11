import { createRequire, syncBuiltinESMExports } from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { compiled, logger } from './_media-harness';

/*
 * Real TailStream asynchronous completion guards, timers and descriptor bookkeeping. The `fs` calls
 * the stream makes are replaced on the builtin module so that a completion can be delivered after the
 * stream was closed, or after its descriptor changed, exactly when the test chooses.
 */

const tail = compiled<any>('lib', 'TailStream.js');
const container = compiled<any>('model', 'ModelContainer.js').default;
const nodeRequire = createRequire(import.meta.url);
const nodeFs = nodeRequire('node:fs') as Record<string, unknown>;

const SYNTHETIC_FD = 4_242;

interface TailInternals {
    checkFile(sizeAtEndOfFile: number): void;
    checkFileTimer: NodeJS.Timeout | null;
    checkIdleTimer: NodeJS.Timeout | null;
    closeFileDescriptor(fd: number): void;
    closedFileDescriptors: Set<number>;
    destroy(error?: Error): void;
    doRead(): void;
    fd: number | null;
    getFdInProgress: boolean;
    isClosed: boolean;
    offset: number;
    on(event: string, listener: (...args: any[]) => void): unknown;
    openRetryTimer: NodeJS.Timeout | null;
    push: (chunk: unknown) => boolean;
    readInProgress: boolean;
    readPending: number;
    _read(size: number): void;
}

const restorers: Array<() => void> = [];
const replaceFsFunction = <T extends (...args: any[]) => unknown>(name: string, replacement: T): T => {
    const original = nodeFs[name];
    nodeFs[name] = replacement;
    syncBuiltinESMExports();
    restorers.push(() => {
        nodeFs[name] = original;
        syncBuiltinESMExports();
    });
    return replacement;
};

const makeStream = (): TailInternals =>
    tail.createReadStream('synthetic-recording-that-does-not-exist.ts', { start: 0 }) as TailInternals;

/** The constructor starts opening the (missing) file; wait for that to settle so only the test drives the stream. */
const settled = async (stream: TailInternals): Promise<TailInternals> => {
    await vi.waitFor(() => expect(stream.getFdInProgress).toBe(false));
    return stream;
};

/** Leave no synthetic descriptor behind for dispose() to close. */
const finish = (stream: TailInternals): void => {
    stream.fd = null;
    stream.isClosed = false;
    stream.destroy();
};

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
    for (const restore of restorers.splice(0).reverse()) restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('TailStream completions that arrive after the stream moved on', () => {
    it.each([
        ['closed', (stream: TailInternals) => (stream.isClosed = true)],
        ['reopened on another descriptor', (stream: TailInternals) => (stream.fd = SYNTHETIC_FD + 1)],
    ])(
        '[MD-DOUBLE-PARITY-TAIL] ignores a size lookup that completes after the stream was %s',
        async (_label, change) => {
            let complete: ((error: Error | null, stat: { size: number }) => void) | undefined;
            replaceFsFunction('fstat', (_fd: number, callback: typeof complete) => {
                complete = callback;
            });
            const read = replaceFsFunction('read', vi.fn());
            const stream = await settled(makeStream());
            stream.fd = SYNTHETIC_FD;
            stream.readPending = 10;

            stream.doRead();
            expect(stream.readInProgress).toBe(true);
            change(stream);
            complete?.(null, { size: 5 });

            expect(stream.readInProgress).toBe(false);
            expect(read).not.toHaveBeenCalled();
            finish(stream);
        },
    );

    it.each([
        ['closed', (stream: TailInternals) => (stream.isClosed = true)],
        ['reopened on another descriptor', (stream: TailInternals) => (stream.fd = SYNTHETIC_FD + 1)],
    ])(
        '[MD-DOUBLE-PARITY-TAIL] drops data from a read that completes after the stream was %s',
        async (_label, change) => {
            let complete: ((error: Error | null, bytesRead: number, buffer: Buffer) => void) | undefined;
            replaceFsFunction('fstat', (_fd: number, callback: (error: Error | null, stat: { size: number }) => void) =>
                callback(null, { size: 5 }),
            );
            replaceFsFunction('read', (...args: unknown[]) => {
                complete = args[args.length - 1] as typeof complete;
            });
            const stream = await settled(makeStream());
            const push = vi.spyOn(stream, 'push');
            stream.fd = SYNTHETIC_FD;
            stream.readPending = 10;

            stream.doRead();
            expect(complete).toBeDefined();
            expect(stream.readInProgress).toBe(true);
            change(stream);
            complete?.(null, 5, Buffer.from('abcde'));

            expect(stream.readInProgress).toBe(false);
            expect(push).not.toHaveBeenCalled();
            expect(stream.readPending).toBe(10);
            finish(stream);
        },
    );

    it('[MD-DOUBLE-PARITY-TAIL] delivers a completed read, advances the offset and keeps an idle check armed', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        replaceFsFunction('fstat', (_fd: number, callback: (error: Error | null, stat: { size: number }) => void) =>
            callback(null, { size: 5 }),
        );
        replaceFsFunction(
            'read',
            (
                _fd: number,
                buffer: Buffer,
                _offset: number,
                _length: number,
                _position: number,
                callback: (error: Error | null, bytesRead: number, buffer: Buffer) => void,
            ) => {
                buffer.write('abcde');
                callback(null, 5, buffer);
            },
        );
        const stream = makeStream();
        await vi.waitFor(() => expect(stream.getFdInProgress).toBe(false));
        const push = vi.spyOn(stream, 'push').mockReturnValue(true);
        stream.fd = SYNTHETIC_FD;
        stream.readPending = 10;

        stream.doRead();

        expect(push).toHaveBeenCalledOnce();
        expect(Buffer.from((push.mock.calls[0] as unknown[])[0] as Buffer).toString()).toBe('abcde');
        expect(stream.readInProgress).toBe(false);
        expect(stream.readPending).toBe(0);
        expect(stream.offset).toBe(5);
        expect(stream.checkIdleTimer).not.toBeNull();
        finish(stream);
    });

    it('[MD-DOUBLE-PARITY-TAIL] clears the in-progress flag and fails the stream when the size lookup fails', async () => {
        const failure = new Error('synthetic-fstat-failure');
        replaceFsFunction('fstat', (_fd: number, callback: (error: Error | null) => void) => callback(failure));
        const stream = await settled(makeStream());
        const errors: Error[] = [];
        stream.on('error', error => errors.push(error));
        stream.fd = SYNTHETIC_FD;
        stream.readPending = 10;

        stream.doRead();

        expect(stream.readInProgress).toBe(false);
        await vi.waitFor(() => expect(errors).toEqual([failure]));
        finish(stream);
    });

    it('[MD-DOUBLE-PARITY-TAIL] does not start a second size lookup while one is in flight', async () => {
        const fstat = replaceFsFunction('fstat', vi.fn());
        const stream = await settled(makeStream());
        stream.fd = SYNTHETIC_FD;
        stream.readPending = 10;

        stream.doRead();
        stream.doRead();

        expect(fstat).toHaveBeenCalledOnce();
        finish(stream);
    });

    it('[MD-DOUBLE-PARITY-TAIL] does not size-check a stream that has no descriptor or nothing pending', async () => {
        const fstat = replaceFsFunction('fstat', vi.fn());
        const stream = await settled(makeStream());

        stream.fd = null;
        stream.readPending = 10;
        stream.doRead();
        stream.fd = SYNTHETIC_FD;
        stream.readPending = 0;
        stream.doRead();

        expect(fstat).not.toHaveBeenCalled();
        expect(stream.readInProgress).toBe(false);
        finish(stream);
    });
});

describe('TailStream timers', () => {
    it('[MD-DOUBLE-PARITY-TAIL] cancels the idle, growth and open-retry timers when it is destroyed', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const stream = makeStream();
        await vi.waitFor(() => expect(stream.getFdInProgress).toBe(false));
        stream.checkIdleTimer = setTimeout(() => undefined, 1_000);
        stream.checkFileTimer = setTimeout(() => undefined, 1_000);
        stream.openRetryTimer = setTimeout(() => undefined, 1_000);
        expect(vi.getTimerCount()).toBe(3);

        stream.destroy();

        expect(stream.checkIdleTimer).toBeNull();
        expect(stream.checkFileTimer).toBeNull();
        expect(stream.openRetryTimer).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[MD-DOUBLE-PARITY-TAIL] keeps a single growth check pending when asked to check again', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const stream = makeStream();
        await vi.waitFor(() => expect(stream.getFdInProgress).toBe(false));

        stream.checkFile(100);
        const first = stream.checkFileTimer;
        stream.checkFile(100);

        expect(stream.checkFileTimer).toBe(first);
        expect(vi.getTimerCount()).toBe(1);
        stream.destroy();
    });

    it('[MD-DOUBLE-PARITY-TAIL] does not look at the file when the growth check fires after the stream was closed', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const stat = replaceFsFunction('stat', vi.fn());
        const stream = makeStream();
        await vi.waitFor(() => expect(stream.getFdInProgress).toBe(false));

        stream.checkFile(100);
        stream.isClosed = true;
        await vi.advanceTimersByTimeAsync(1_000);

        expect(stat).not.toHaveBeenCalled();
        expect(stream.checkFileTimer).toBeNull();
        stream.isClosed = false;
        stream.destroy();
    });
});

describe('TailStream read requests and descriptor bookkeeping', () => {
    it('[MD-DOUBLE-PARITY-TAIL] ignores a read request while one is already pending', async () => {
        const stream = await settled(makeStream());
        const open = replaceFsFunction('open', vi.fn());
        stream.readPending = 5;

        stream._read(64);

        expect(stream.readPending).toBe(5);
        expect(open).not.toHaveBeenCalled();
        finish(stream);
    });

    it('[MD-DOUBLE-PARITY-TAIL] ignores a read request of zero bytes and retries the open for a real request', async () => {
        const stream = await settled(makeStream());
        const open = replaceFsFunction('open', vi.fn());

        stream._read(0);
        expect(open).not.toHaveBeenCalled();
        expect(stream.readPending).toBe(0);

        stream._read(8);
        expect(open).toHaveBeenCalledOnce();
        expect(stream.readPending).toBe(8);
        expect(stream.getFdInProgress).toBe(true);
        finish(stream);
    });

    it('[MD-DOUBLE-PARITY-TAIL] remembers a closed descriptor and closes it only once', async () => {
        const close = replaceFsFunction('close', vi.fn());
        const stream = await settled(makeStream());

        stream.closeFileDescriptor(SYNTHETIC_FD);
        stream.closeFileDescriptor(SYNTHETIC_FD);

        expect(close).toHaveBeenCalledOnce();
        expect(close.mock.calls[0][0]).toBe(SYNTHETIC_FD);
        expect(stream.closedFileDescriptors.has(SYNTHETIC_FD)).toBe(true);
        finish(stream);
    });
});
