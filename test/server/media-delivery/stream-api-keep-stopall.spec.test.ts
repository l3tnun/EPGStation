import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, executionManager, fakeChild, fakeStream, logger } from './_media-harness';

const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;
const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;
const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;

const dirs: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const createApi = (streamManageModel: unknown): any =>
    new StreamApiModel(
        {},
        async () => fakeStream(),
        async () => fakeStream(),
        async () => fakeStream(),
        async () => fakeStream(),
        streamManageModel,
        {},
        {},
        {},
        {},
        {},
    );

describe('StreamApiModel keep / stopAll delegation', () => {
    it('[MD-3.10] extends an HLS stop deadline to fifteen seconds through api.keep', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-api-keep-contract-'));
        dirs.push(dir);
        const tuner = new PassThrough();
        const child = fakeChild();
        const handle = Object.freeze({ kind: 'api-keep-hls-writer' });
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            {
                createHlsWriter: vi.fn(async () => ({ child, handle })),
                stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
            },
            new HLSFileDeleterModel({ getLogger: logger }),
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 101, cmd: '%NODE%' }, 0);
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const api = createApi(manager);

        vi.useFakeTimers();
        const stop = vi.spyOn(model, 'stop').mockResolvedValue(undefined);

        await expect(manager.start(model)).resolves.toBe(0);

        await vi.advanceTimersByTimeAsync(14_999);
        api.keep(0);
        await vi.advanceTimersByTimeAsync(14_999);

        expect(stop).not.toHaveBeenCalled();
        await model.stop();
    });

    it('[MD-4.4] stops every stream accepted at call time through api.stopAll', async () => {
        const manager = new StreamManageModel({ getLogger: logger }, executionManager(), { notifyClient: vi.fn() });
        const api = createApi(manager);
        const first = fakeStream({ isEnable: true, mode: 0, type: 'LiveStream' });
        const second = fakeStream({ isEnable: true, mode: 0, type: 'LiveHLS' });
        const third = fakeStream({ isEnable: false, mode: 0, type: 'RecordedStream' });

        await expect(manager.start(first)).resolves.toBe(0);
        await expect(manager.start(second)).resolves.toBe(1);
        await expect(manager.start(third)).resolves.toBe(2);
        expect(manager.getStreamInfos()).toHaveLength(3);

        await api.stopAll();

        expect(first.stop).toHaveBeenCalledOnce();
        expect(second.stop).toHaveBeenCalledOnce();
        expect(third.stop).toHaveBeenCalledOnce();
        expect(manager.getStreamInfos()).toEqual([]);
    });
});
