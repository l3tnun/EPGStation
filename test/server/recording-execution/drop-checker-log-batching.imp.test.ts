import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, load, logger } from './_harness';

const DropCheckerModel = load<new (...args: any[]) => any>('model', 'operator', 'recording', 'DropCheckerModel.js');
const FileUtil = load<any>('util', 'FileUtil.js');

describe('DropChecker detail batching and finish ownership (imp)', () => {
    let checker: any;
    let source: PassThrough;
    let append: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.spyOn(FileUtil, 'access').mockResolvedValue(undefined);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(
            Object.assign(new Error('synthetic absent file'), { code: 'ENOENT' }),
        );
        vi.spyOn(FileUtil, 'touchFile').mockResolvedValue(undefined);
        append = vi.spyOn(FileUtil, 'appendFile').mockResolvedValue(undefined);
        checker = new DropCheckerModel({ getLogger: () => logger });
        source = new PassThrough();
        await checker.prepare(join(tmpdir(), 'synthetic-drop-batch'), 'synthetic-input.ts');
        checker.attach('synthetic-input.ts', source);
    });

    afterEach(async () => {
        await checker.stop();
        source.destroy();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('flushes at 100 ms from the first line, retaining order without resetting the timer', async () => {
        checker.tsPacketAnalyzer.emit('packetDrop', 0x0100, 3, 2);
        await vi.advanceTimersByTimeAsync(50);
        checker.tsPacketAnalyzer.emit('packetError', 0x0101, 5, 4);
        await vi.advanceTimersByTimeAsync(49);
        expect(append).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(append).toHaveBeenCalledExactlyOnceWith(
            checker.getFilePath(),
            'drop (pid: 0x0100, counter: 3, expected: 2, time: -)\n' +
                'error: (pid: 0x0101, counter: 5, expected: 4, time: -)\n',
        );
        expect(checker.logFlushTimer).toBeNull();
        await vi.advanceTimersByTimeAsync(100);
        expect(append).toHaveBeenCalledTimes(1);
    });

    it.each([0, 1])('flushes on reaching or exceeding 64 KiB of UTF-8 bytes (extra=%i)', async extra => {
        // Multibyte text distinguishes byte counting from JS string length.
        const first = 'é'.repeat(32767) + '\n';
        checker.queueLogLine(first);
        await Promise.resolve();
        expect(append).not.toHaveBeenCalled();
        checker.queueLogLine('x'.repeat(1 + extra));
        await checker.logWriteTail;
        expect(append).toHaveBeenCalledExactlyOnceWith(checker.getFilePath(), first + 'x'.repeat(1 + extra));
        expect(checker.logFlushTimer).toBeNull();
        await vi.advanceTimersByTimeAsync(100);
        expect(append).toHaveBeenCalledTimes(1);
    });

    it('serializes batches and makes overlapping stops wait for a natural finish exactly once', async () => {
        const gate = deferred();
        append.mockImplementationOnce(() => gate.promise);
        checker.queueLogLine('a'.repeat(65536));
        await Promise.resolve();
        expect(append).toHaveBeenCalledTimes(1);
        checker.tsPacketAnalyzer.emit('packetDrop', 0x0100, 3, 2);
        checker.tsPacketAnalyzer.emit('finish');
        let settled = 0;
        const firstStop = checker.stop().then(() => settled++);
        const secondStop = checker.stop().then(() => settled++);
        try {
            await Promise.resolve();
            expect(settled).toBe(0);
            expect(append).toHaveBeenCalledTimes(1);
            expect(checker.logFlushTimer).toBeNull();
        } finally {
            gate.resolve();
            await Promise.all([firstStop, secondStop]);
        }
        expect(settled).toBe(2);
        expect(append.mock.calls.map(call => call[1])).toEqual([
            'a'.repeat(65536),
            'drop (pid: 0x0100, counter: 3, expected: 2, time: -)\n',
            '\n',
        ]);
        checker.queueLogLine('late detail');
        await vi.advanceTimersByTimeAsync(100);
        expect(append).toHaveBeenCalledTimes(3);
    });

    it('logs one failed batch and continues with later details and the summary without retry', async () => {
        const failure = new Error('synthetic append failure');
        append.mockRejectedValueOnce(failure);
        checker.queueLogLine('a'.repeat(65536));
        await checker.logWriteTail;
        checker.tsPacketAnalyzer.emit('packetError', 0x0100, 1, 2);
        await checker.stop();
        expect(logger.system.error).toHaveBeenCalledWith(`append error: ${checker.getFilePath()}`);
        expect(logger.system.error).toHaveBeenCalledWith(failure);
        expect(append.mock.calls.map(call => call[1])).toEqual([
            'a'.repeat(65536),
            'error: (pid: 0x0100, counter: 1, expected: 2, time: -)\n',
            '\n',
        ]);
        expect(checker.logFlushTimer).toBeNull();
    });

    it('returns analysis results before log settlement and clears result-wait timers', async () => {
        const gate = deferred();
        append.mockImplementationOnce(() => gate.promise);
        checker.tsPacketAnalyzer.emit('packetDrop', 0x0100, 3, 2);
        const result1 = checker.getResult();
        const result2 = checker.getResult();
        checker.tsPacketAnalyzer.emit('finish');
        try {
            await expect(result1).resolves.toEqual({});
            await expect(result2).resolves.toEqual({});
            expect(vi.getTimerCount()).toBe(0);
            expect(checker.listener.listenerCount('finish_event')).toBe(0);
        } finally {
            gate.resolve();
            await checker.stop();
        }
        expect(checker.logBuffer).toEqual([]);
    });
});
