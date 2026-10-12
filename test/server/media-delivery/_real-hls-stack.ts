import 'reflect-metadata';

import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, vi } from 'vitest';

import { baseConfig, compiled, executionManager } from './_media-harness';

/*
 * 本物の StreamManageModel・LiveHLSStreamModel・HLSFileDeleterModel・HlsStreamIdAllocator・EncodeProcessManageModel を、
 * 実 file system と実際に起動した writer（node の script。process group として起動される）でつなぐ土台。
 * HLS の結合 test（`hls-real-components`・`hls-unconfirmed-stop`）が共有する。
 */

const LiveHLSStreamModel = compiled<{ default: new (...args: any[]) => any }>(
    'model',
    'service',
    'stream',
    'LiveHLSStreamModel.js',
).default;
const LiveStreamModel = compiled<{ default: new (...args: any[]) => any }>(
    'model',
    'service',
    'stream',
    'LiveStreamModel.js',
).default;
const HLSFileDeleterModel = compiled<{ default: new (...args: any[]) => any }>(
    'model',
    'service',
    'stream',
    'util',
    'HLSFileDeleterModel.js',
).default;
const HlsStreamIdAllocator = compiled<{ default: new (...args: any[]) => any }>(
    'model',
    'service',
    'stream',
    'manager',
    'HlsStreamIdAllocator.js',
).default;
const StreamManageModel = compiled<{ default: new (...args: any[]) => any }>(
    'model',
    'service',
    'stream',
    'manager',
    'StreamManageModel.js',
).default;
const EncodeProcessManageModel = compiled<{ default: new (...args: any[]) => any }>(
    'model',
    'service',
    'encode',
    'EncodeProcessManageModel.js',
).default;

const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

/** test ごとの後始末（stack の停止と作業 directory の削除）。 */
export const cleanupStacks = async (): Promise<void> => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const directory of directories.splice(0)) {
        await chmod(directory, 0o700).catch(() => undefined);
        await rm(directory, { force: true, recursive: true });
    }
};

export interface Logs {
    readonly stream: Record<'debug' | 'error' | 'fatal' | 'info' | 'warn', ReturnType<typeof vi.fn>>;
    readonly encode: Record<'debug' | 'error' | 'info' | 'warn', ReturnType<typeof vi.fn>>;
}

export const makeStack = async (options: {
    createDirectory: boolean;
    /** 指定すると、mock の log の代わりにこの logger を使う（実の `LoggerModel` など）。 */
    loggerModel?: { getLogger(): any };
    mode?: number;
}) => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-real-hls-'));
    directories.push(root);
    const streamRoot = join(root, 'streamfiles');
    if (options.createDirectory) await mkdir(streamRoot);
    if (options.mode !== undefined) await chmod(streamRoot, options.mode);
    const script = join(root, 'hls-writer.cjs');
    await writeFile(
        script,
        [
            "const fs = require('node:fs');",
            "const path = require('node:path');",
            'const [directory, number] = process.argv.slice(2);',
            "process.on('SIGINT', () => process.exit(0));",
            "fs.writeFileSync(path.join(directory, 'stream' + number + '-0.ts'), 'synthetic-segment');",
            "fs.writeFileSync(path.join(directory, 'stream' + number + '.m3u8'), '#EXTM3U\\n#EXTINF:1,\\nstream' + number + '-0.ts\\n');",
            'process.stdin.resume();',
            'setInterval(() => undefined, 1000);',
        ].join('\n'),
    );
    const logs: Logs = {
        stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
        encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    const loggerModel = options.loggerModel ?? { getLogger: () => ({ ...logs, system: logs.stream }) };
    const processManager = new EncodeProcessManageModel(loggerModel, { getConfig: () => ({ encodeProcessNum: 1 }) });
    const config = baseConfig({ streamFilePath: streamRoot });
    const configuration = { getConfig: () => config };
    const deleter = new HLSFileDeleterModel(loggerModel);
    const allocator = new HlsStreamIdAllocator(loggerModel, configuration, deleter);
    const manager = new StreamManageModel(loggerModel, executionManager(), { notifyClient: vi.fn() }, allocator);
    cleanups.push(async () => {
        await chmod(streamRoot, 0o700).catch(() => undefined);
        await manager.stopAll();
    });

    const hlsModel = () => {
        const tuner = new PassThrough();
        const model = new LiveHLSStreamModel(
            configuration,
            loggerModel,
            processManager,
            deleter,
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(() => tuner.destroy()), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: `${process.execPath} ${script} %streamFileDir% %streamNum%` }, 0);
        return model;
    };
    const directModel = () => {
        const tuner = new PassThrough();
        const model = new LiveStreamModel(
            configuration,
            loggerModel,
            processManager,
            deleter,
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(() => tuner.destroy()), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 102 }, 0);
        return model;
    };
    return { streamRoot, logs, manager, processManager, hlsModel, directModel, script };
};

export const registryOf = (processManager: any): unknown[] => processManager.childs;

export const errorCalls = (logs: Logs): any[] => logs.stream.error.mock.calls.map(call => call[0]);

export const startAndWaitForArtifacts = async (stack: Awaited<ReturnType<typeof makeStack>>): Promise<number> => {
    const streamId = (await stack.manager.start(stack.hlsModel())) as number;
    await vi.waitFor(async () => expect(await readdir(stack.streamRoot)).toContain(`stream${streamId}.m3u8`), {
        interval: 20,
        timeout: 20_000,
    });
    return streamId;
};
