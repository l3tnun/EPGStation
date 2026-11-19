import 'reflect-metadata';

import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedPlaybackSourceProvider = (
    require(join(snapshot, 'model/operator/recorded/RecordedPlaybackSourceProvider.js')) as {
        default: new (...args: any[]) => {
            open(
                videoFileId: number,
                expectedRecordedId: number,
                playPosition: number,
                option?: { cacheVideoInfo?: boolean },
            ): Promise<{
                adopt():
                    { readonly status: 'adopted'; readonly source: Record<string, any> } | { readonly status: 'stale' };
                disposeBeforeAdoption(): Promise<void>;
            }>;
        };
    }
).default;

const temporaryRoots: string[] = [];
const temporaryRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-playback-cache-'));
    temporaryRoots.push(root);
    return root;
};

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

const completedHlsInfo = { bitRate: 64, duration: 60, size: 11 };

const completedHlsInput = (
    resolveInput: (videoFile: { id: number }) => string,
    getInfo: (path: string) => Promise<typeof completedHlsInfo>,
) => {
    const provider = new RecordedPlaybackSourceProvider(
        { findId: async (id: number) => ({ id, recordedId: 90, type: 'ts' }) },
        { findId: async () => ({ id: 90, isRecording: false }) },
        { getFullFilePathFromVideoFile: resolveInput, getInfo },
        {
            openCompletedFile: async () => ({ close: async () => undefined, readable: null }),
            openRecordingTail: async () => {
                throw new Error('Recording tail is not used for completed metadata');
            },
        },
    );
    return async (videoFileId = 301) => {
        const opened = await provider.open(videoFileId, 90, 0, { cacheVideoInfo: true });
        const result = opened.adopt();
        if (result.status !== 'adopted') throw new Error('Expected a completed playback source');
        await result.source.reader.close();
        return result.source.videoInfo;
    };
};

describe('recorded playback metadata cache (unittest/imp)', () => {
    it('reuses completed HLS metadata, then reprobes a replaced file and a recording in progress', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'first input');
        const recorded = { id: 90, isRecording: false };
        const videoUtil = {
            getFullFilePathFromVideoFile: () => inputPath,
            getInfo: vi.fn(async () => ({ bitRate: 64, duration: 60, size: 11 })),
        };
        const provider = new RecordedPlaybackSourceProvider(
            { findId: async () => ({ id: 301, recordedId: 90, type: 'ts' }) },
            { findId: async () => recorded },
            videoUtil,
        );
        const open = async (cacheVideoInfo: boolean) => {
            const source = await provider.open(301, 90, 0, { cacheVideoInfo });
            await source.disposeBeforeAdoption();
        };

        await open(true);
        await open(true);
        expect(videoUtil.getInfo).toHaveBeenCalledTimes(1);

        const replacement = join(root, 'replacement.ts');
        await writeFile(replacement, 'other input');
        await rename(replacement, inputPath);
        await open(true);
        expect(videoUtil.getInfo).toHaveBeenCalledTimes(2);

        await open(false);
        expect(videoUtil.getInfo).toHaveBeenCalledTimes(3);
        recorded.isRecording = true;
        await open(true);
        await open(true);
        expect(videoUtil.getInfo).toHaveBeenCalledTimes(5);
    });

    it('probes without a file fingerprint and caches only once the file can be identified', async () => {
        const inputPath = join(await temporaryRoot(), 'recording.ts');
        await writeFile(inputPath, 'recording');
        const getInfo = vi.fn(async () => completedHlsInfo);
        const openHls = completedHlsInput(() => inputPath, getInfo);
        const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');
        const stat = fsPromises.stat;
        const statSpy = vi.spyOn(fsPromises, 'stat').mockImplementation((path, options) => {
            if (path === inputPath) return Promise.reject(Object.assign(new Error('stat failed'), { code: 'EACCES' }));
            return stat(path, options);
        });
        syncBuiltinESMExports();

        try {
            await expect(openHls()).resolves.toEqual(completedHlsInfo);
            await expect(openHls()).resolves.toEqual(completedHlsInfo);
            expect(getInfo).toHaveBeenCalledTimes(2);
        } finally {
            statSpy.mockRestore();
            syncBuiltinESMExports();
        }

        await openHls();
        await openHls();
        expect(getInfo).toHaveBeenCalledTimes(3);
    });

    it('reprobes directory paths and metadata with zero or negative values', async () => {
        const root = await temporaryRoot();
        const directoryInfo = vi.fn(async () => completedHlsInfo);
        const openDirectory = completedHlsInput(() => root, directoryInfo);
        await openDirectory();
        await openDirectory();
        expect(directoryInfo).toHaveBeenCalledTimes(2);

        const inputPath = join(root, 'recording.ts');
        await writeFile(inputPath, 'recording');
        const getInfo = vi.fn(async () => completedHlsInfo);
        const openHls = completedHlsInput(() => inputPath, getInfo);
        getInfo.mockResolvedValueOnce({ ...completedHlsInfo, size: 0 });
        getInfo.mockResolvedValueOnce({ ...completedHlsInfo, duration: -1 });

        await openHls();
        await openHls();
        await openHls();
        await openHls();
        expect(getInfo).toHaveBeenCalledTimes(3);
    });

    it.each(['probe failure', 'non-finite metadata'])('reprobes after %s instead of caching it', async outcome => {
        const inputPath = join(await temporaryRoot(), 'recording.ts');
        await writeFile(inputPath, 'recording');
        const getInfo = vi.fn(async () => completedHlsInfo);
        const openHls = completedHlsInput(() => inputPath, getInfo);

        if (outcome === 'probe failure') {
            const failure = new Error('synthetic ffprobe failure');
            getInfo.mockRejectedValueOnce(failure);
            await expect(openHls()).rejects.toBe(failure);
        } else {
            getInfo.mockResolvedValueOnce({ ...completedHlsInfo, bitRate: NaN });
            await expect(openHls()).resolves.toMatchObject({ bitRate: NaN });
        }

        await expect(openHls()).resolves.toEqual(completedHlsInfo);
        await expect(openHls()).resolves.toEqual(completedHlsInfo);
        expect(getInfo).toHaveBeenCalledTimes(2);
    });

    it('keeps the replacement metadata when an older probe finishes after the replacement probe', async () => {
        const root = await temporaryRoot();
        const inputPath = join(root, 'recording.ts');
        const replacement = join(root, 'replacement.ts');
        await writeFile(inputPath, 'first input');
        await writeFile(replacement, 'replacement input');
        const replacementInfo = { ...completedHlsInfo, bitRate: 128 };
        const probeStarted = Promise.withResolvers<void>();
        const oldProbe = Promise.withResolvers<typeof completedHlsInfo>();
        const getInfo = vi
            .fn(async () => replacementInfo)
            .mockImplementationOnce(() => {
                probeStarted.resolve();
                return oldProbe.promise;
            });
        const openHls = completedHlsInput(() => inputPath, getInfo);

        const first = openHls();
        try {
            await probeStarted.promise;
            await rename(replacement, inputPath);
            await expect(openHls()).resolves.toEqual(replacementInfo);
        } finally {
            oldProbe.resolve(completedHlsInfo);
            await first;
        }
        await expect(openHls()).resolves.toEqual(replacementInfo);
        expect(getInfo).toHaveBeenCalledTimes(2);
    });

    it('evicts the least recently used metadata when a 129th input is cached', async () => {
        const root = await temporaryRoot();
        const inputPath = ({ id }: { id: number }) => join(root, `recording-${id}.ts`);
        const getInfo = vi.fn(async () => completedHlsInfo);
        const openHls = completedHlsInput(inputPath, getInfo);

        for (let id = 1; id <= 129; id++) await writeFile(inputPath({ id }), 'recording');
        for (let id = 1; id <= 128; id++) await openHls(id);
        expect(getInfo).toHaveBeenCalledTimes(128);

        await openHls(1);
        await openHls(129);
        await openHls(1);
        await openHls(2);
        expect(getInfo).toHaveBeenCalledTimes(130);
        expect(getInfo).toHaveBeenNthCalledWith(129, inputPath({ id: 129 }));
        expect(getInfo).toHaveBeenLastCalledWith(inputPath({ id: 2 }));
    });
});
