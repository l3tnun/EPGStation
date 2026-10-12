import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncoderModel = (
    require(join(snapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: new (...args: unknown[]) => {
            cancel(): Promise<void>;
            setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
            setOption(option: {
                encodeId: number;
                mode: string;
                parentDir: string;
                recordedId: number;
                removeOriginal: boolean;
                sourceVideoFileId: number;
            }): void;
            start(): Promise<void>;
        };
    }
).default;

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
    vi.restoreAllMocks();
});

/**
 * Real EncoderModel.start videoUtil.getInfo catch (L280–283) plus cancel/exit cleanup.
 * Child process starts with stdout; getInfo reject logs twice and skips progress wiring.
 * cancel → requestStop(handle); synthetic exit drives childEndProcessing listener/timer cleanup.
 * Object.create is forbidden — use the real constructor.
 */
const makeSubject = () => {
    const encodeLog = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const root = mkdtempSync(join(tmpdir(), 'epgstation-encoder-getinfo-'));
    temporaryDirectories.push(root);
    const inputPath = join(root, 'input.ts');
    writeFileSync(inputPath, 'synthetic input');
    const getInfoFailure = new Error('SyntheticGetInfoFailure');
    const managedHandle = Object.freeze({ id: 'synthetic-managed-handle' });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        kill: vi.fn(() => true),
        pid: 4242,
        signalCode: null as NodeJS.Signals | null,
        stderr,
        stdin,
        stdout,
    });
    const processManager = {
        createManaged: vi.fn(async () => ({ child, handle: managedHandle })),
        requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'] as const, status: 'requested' as const })),
    };
    const videoUtil = {
        getFullFilePathFromId: vi.fn(async () => inputPath),
        getInfo: vi.fn(async () => {
            throw getInfoFailure;
        }),
        getParentDirPath: vi.fn(() => root),
    };
    const encoder = new EncoderModel(
        { getLogger: () => ({ encode: encodeLog }) },
        {
            getConfig: () => ({
                encode: [{ name: 'synthetic-mode', cmd: `${process.execPath} -e "process.exit(0)"` }],
                ffmpeg: join(root, 'ffmpeg'),
                ffprobe: join(root, 'ffprobe'),
            }),
        },
        processManager,
        { getFilePath: vi.fn(), release: vi.fn() },
        { findId: vi.fn(async () => ({ id: 92, recordedId: 91, filePath: 'synthetic.ts' })) },
        {
            findId: vi.fn(async () => ({
                id: 91,
                channelId: 7,
                duration: 60,
                startAt: 1,
                endAt: 61,
                name: 'synthetic',
                halfWidthName: 'synthetic',
            })),
        },
        { findId: vi.fn(async () => ({ id: 7, name: 'synthetic-ch', halfWidthName: 'ch' })) },
        videoUtil,
        {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        },
        { formatFilePathString: vi.fn(async (directory: string) => directory) },
    );
    return {
        child,
        encodeLog,
        encoder,
        getInfoFailure,
        inputPath,
        managedHandle,
        processManager,
        stderr,
        stdin,
        stdout,
        videoUtil,
    };
};

const option = {
    encodeId: 9201,
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId: 91,
    removeOriginal: false,
    sourceVideoFileId: 92,
};

describe('EncoderModel.start videoUtil.getInfo catch (unittest/imp)', () => {
    it('[R2-ENCODER-START-GETINFO-CATCH] getInfo reject logs pair; cancel/exit clears stop+listeners+timer', async () => {
        vi.useFakeTimers();
        const {
            child,
            encodeLog,
            encoder,
            getInfoFailure,
            inputPath,
            managedHandle,
            processManager,
            stderr,
            stdin,
            stdout,
            videoUtil,
        } = makeSubject();
        encoder.setOption(option);

        let finishArgs: { isError: boolean; outputFilePath: string | null } | undefined;
        const finished = new Promise<void>(resolve => {
            encoder.setOnFinish((isError, outputFilePath) => {
                finishArgs = { isError, outputFilePath };
                resolve();
            });
        });

        await expect(encoder.start()).resolves.toBeUndefined();

        expect(processManager.createManaged).toHaveBeenCalledOnce();
        expect(videoUtil.getInfo).toHaveBeenCalledExactlyOnceWith(inputPath);
        expect(encodeLog.error).toHaveBeenCalledWith(`get encode vidoe file info: ${inputPath}`);
        expect(encodeLog.error).toHaveBeenCalledWith(getInfoFailure);
        expect(encodeLog.error).toHaveBeenCalledTimes(2);
        expect(child.listenerCount('exit')).toBe(1);
        expect(stderr.listenerCount('data')).toBe(1);
        expect(stdout.listenerCount('data')).toBe(0);
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        expect(processManager.requestStop).not.toHaveBeenCalled();

        await encoder.cancel();
        expect(processManager.requestStop).toHaveBeenCalledExactlyOnceWith(managedHandle);

        child.emit('exit', 0, null);
        await finished;

        expect(finishArgs).toEqual({ isError: true, outputFilePath: null });
        expect(child.listenerCount('exit')).toBe(0);
        expect(stderr.listenerCount('data')).toBe(0);
        expect(stdout.listenerCount('data')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);

        stdout.destroy();
        stderr.destroy();
        stdin.destroy();
    });
});
