import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { load, logger } from './_harness';

// 準備（await する fs 処理）の後に、同期の attach で stream へ繋ぐ。録画での呼び出し順と同じ。
const startDropChecker = async (
    target: { prepare(dir: string, src: string): Promise<void>; attach(src: string, stream: any): void },
    logDirPath: string,
    srcFilePath: string,
    readableStream: unknown,
): Promise<void> => {
    await target.prepare(logDirPath, srcFilePath);
    target.attach(srcFilePath, readableStream);
};

const DropCheckerModel = load<new (...args: any[]) => any>('model', 'operator', 'recording', 'DropCheckerModel.js');

/**
 * Real DropCheckerModel.attach stream.finished error branch (L123–126).
 * Public prepare and attach with a Readable that ends in error logs, auto-calls public stop, and tears down streams.
 * Success finish path is out of scope. Do not manually invoke a second stop().
 */
describe('DropCheckerModel.attach stream.finished error (unittest/imp)', () => {
    let roots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
        roots = [];
    });

    const makeRoot = async (): Promise<string> => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-dropchecker-finished-err-'));
        roots.push(root);
        return root;
    };

    it('[R2-DROPCHECKER-FINISHED-ERR] attach logs stream error, auto-stops once, and nulls stream resources', async () => {
        const root = await makeRoot();
        const checker = new DropCheckerModel({ getLogger: () => logger });
        const stopSpy = vi.spyOn(checker, 'stop');
        const readable = new PassThrough();
        const srcFilePath = 'synthetic-error.ts';

        await startDropChecker(checker, root, srcFilePath, readable);
        expect(checker.getFilePath()).toBe(join(root, 'synthetic-error.ts.log'));
        expect(checker.transformStream).not.toBeNull();

        readable.destroy(new Error('synthetic stream failure'));

        await vi.waitFor(() => {
            expect(logger.system.error).toHaveBeenCalledWith(`drop log check stream error: ${srcFilePath}`);
        });
        await vi.waitFor(() => {
            expect(stopSpy).toHaveBeenCalledOnce();
        });

        const autoStop = stopSpy.mock.results[0]?.value as Promise<void> | undefined;
        expect(autoStop).toBeInstanceOf(Promise);
        await autoStop;

        expect(logger.system.info).toHaveBeenCalledWith(expect.stringMatching(/^stop drop check:/));
        expect(checker.transformStream).toBeNull();
        expect(checker.tsReadableConnector).toBeNull();
        expect(checker.tsPacketParser).toBeNull();
        expect(checker.tsPacketAnalyzer).toBeNull();
        expect(checker.tsSectionParser).toBeNull();
        expect(checker.tsSectionAnalyzer).toBeNull();
        expect(checker.tsSectionUpdater).toBeNull();
        expect(checker.tsPacketSelector).toBeNull();
        expect(stopSpy).toHaveBeenCalledOnce();
    });
});
