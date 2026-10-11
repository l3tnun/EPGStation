import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, logger } from './_media-harness';

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;

const directories: string[] = [];
const models: any[] = [];

afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const model of models.splice(0)) await model.stop().catch(() => undefined);
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const makeLive = (hls: boolean, fileDeleter: Record<string, unknown> = {}) => {
    const log = logger();
    const scratch = mkdtempSync(join(tmpdir(), 'epg-base-gaps-'));
    directories.push(scratch);
    const socketIO = { notifyClient: vi.fn() };
    const Model = hls ? LiveHLSStreamModel : LiveStreamModel;
    const model = new Model(
        { getConfig: () => baseConfig({ streamFilePath: scratch }) },
        { getLogger: () => log },
        { createHlsWriter: vi.fn(), createManaged: vi.fn(), requestStop: vi.fn(), stopHls: vi.fn() },
        { deleteAllFiles: vi.fn(), setOption: vi.fn(), ...fileDeleter },
        { openServiceStream: vi.fn() },
        socketIO,
    );
    model.setOption({ channelId: 101, cmd: '%NODE%' }, 2);
    models.push(model);
    return { log, model, scratch, socketIO };
};

const makeRecorded = (hls: boolean) => {
    const Model = hls ? RecordedHLSStreamModel : RecordedStreamModel;
    const model = new Model(
        { getConfig: () => baseConfig() },
        { getLogger: () => logger() },
        {},
        { deleteAllFiles: vi.fn(), setOption: vi.fn() },
        { notifyClient: vi.fn() },
        { findId: vi.fn() },
        { findId: vi.fn() },
        { getFullFilePathFromId: vi.fn(), getInfo: vi.fn() },
    );
    model.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 5 }, 1);
    return model;
};

const finalizationOf = (overrides: Record<string, unknown> = {}) => ({
    artifactCleanupAttempts: [] as unknown[],
    artifactCleanupOperation: vi.fn(),
    diagnosticLogged: false,
    forceReleased: true,
    releaseArtifactOwnership: vi.fn(),
    streamId: 3,
    ...overrides,
});

/**
 * StreamBaseModel の HLS 後始末の診断と、readiness の確認・playlist の加工。
 */
describe('StreamBaseModel HLS finalization diagnostics and readiness (unittest/imp)', () => {
    it('[MD-10.2] reports an unconfirmed writer stop once a forced release is already recorded', async () => {
        const { log, model } = makeLive(true);
        const finalization = finalizationOf();

        await model.stopHlsWriter(finalization, async () => ({ exitConfirmed: false, sentSignals: ['SIGINT'] }));

        expect(log.stream.error).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                event: 'hls-stop-finalization',
                forceReleased: true,
                streamId: 3,
                writerStopResult: { exitConfirmed: false, sentSignals: ['SIGINT'] },
            }),
        );
    });

    it('[MD-10.2] reports a failed writer stop once a forced release is already recorded', async () => {
        const { log, model } = makeLive(true);
        const failure = new Error('synthetic writer stop failure');

        await model.stopHlsWriter(finalizationOf(), async () => Promise.reject(failure));

        expect(log.stream.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ writerStopFailure: failure }));
    });

    it('[MD-10.2] reports an artifact cleanup that left files behind once a forced release is already recorded', async () => {
        const { log, model } = makeLive(true);
        const finalization = finalizationOf({
            artifactCleanupOperation: vi.fn(async () => ({
                passes: 3,
                remainingFiles: ['stream3.m3u8'],
                status: 'remaining',
            })),
            writerStartPending: false,
        });

        await model.cleanupHlsArtifacts(finalization);

        expect(finalization.releaseArtifactOwnership).toHaveBeenCalledOnce();
        expect(log.stream.error).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                artifactCleanup: { passes: 3, remainingFiles: ['stream3.m3u8'], status: 'remaining' },
                event: 'hls-stop-finalization',
            }),
        );
    });

    it('[MD-10.2] stays silent about a clean finalization and about one that is not force-released', async () => {
        const { log, model } = makeLive(true);
        const clean = finalizationOf({
            artifactCleanupOperation: vi.fn(async () => ({ passes: 1, remainingFiles: [], status: 'cleared' })),
        });
        const notForced = finalizationOf({ forceReleased: false });

        await model.stopHlsWriter(clean, async () => ({ exitConfirmed: true, sentSignals: [] }));
        await model.cleanupHlsArtifacts(clean);
        await model.stopHlsWriter(notForced, async () => ({ exitConfirmed: false, sentSignals: [] }));

        expect(log.stream.error).not.toHaveBeenCalled();
    });

    it('[MD-10.2] restarts the readiness check of an HLS stream that is checked again', () => {
        vi.useFakeTimers();
        const { log, model } = makeLive(true);

        model.startCheckStreamEnable(3);
        const firstGeneration = model.readinessGeneration;
        model.startCheckStreamEnable(3);

        expect(log.stream.info.mock.calls.filter(([message]: [string]) => message === 'start check stream file: 3')).toHaveLength(
            2,
        );
        expect(model.readinessGeneration).not.toBe(firstGeneration);
        expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    });

    it('[MD-10.2] enables the stream and notifies the clients once the playlist and two segments exist', async () => {
        const listExact = vi.fn(async () => ['stream3.m3u8', 'stream3-1.ts', 'stream3-2.ts']);
        const { log, model, socketIO } = makeLive(true, { listExact });

        model.startCheckStreamEnable(3);

        await vi.waitFor(() => expect(socketIO.notifyClient).toHaveBeenCalledOnce());
        expect(log.stream.info).toHaveBeenCalledWith('enable stream: 3');
        expect(model.getInfo().isEnable).toBe(true);
    });

    it('[MD-10.2] leaves a parent playlist without a variant entry unchanged when adding the subtitle information', async () => {
        const { scratch, model } = makeLive(true);
        const playlist = '#EXTM3U\n#EXT-X-VERSION:3\n';
        writeFileSync(join(scratch, 'stream3.m3u8'), playlist);
        model.readinessGeneration = {};

        await model.addSubtitleInfoToParentPlaylist('stream3.m3u8', 'stream3-child_vtt.m3u8', model.readinessGeneration);

        expect(readFileSync(join(scratch, 'stream3.m3u8'), 'utf8')).toBe(playlist);
    });

    it.each([
        ['LiveStream', makeLive(false).model],
        ['LiveHLS', makeLive(true).model],
        ['RecordedStream', makeRecorded(false)],
        ['RecordedHLS', makeRecorded(true)],
    ])('[MD-10.2] reports %s as the stream type', (type, model) => {
        expect(model.getInfo().type).toBe(type);
        expect(model.ownsDiskArtifacts()).toBe(type.includes('HLS'));
    });
});
