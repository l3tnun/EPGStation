import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, deferred, fakeChild, logger } from './_media-harness';

const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;

const directories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const makeLive = (openServiceStream: (...args: any[]) => Promise<unknown>) => {
    const model = new LiveStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: logger },
        { createManaged: vi.fn(), requestStop: vi.fn() },
        { deleteAllFiles: vi.fn(), setOption: vi.fn() },
        { openServiceStream },
        { notifyClient: vi.fn() },
    );
    model.setOption({ channelId: 101 }, 0);
    return model;
};

/**
 * LiveStreamBaseModel の開始中に起きる二重開始と停止の競合。開始は同時に 1 回だけ受け付け、
 * 開始の途中で停止された場合は、後から届いたチューナー接続や HLS writer を閉じて
 * `StreamStartStopped` で終える。
 */
describe('LiveStreamBaseModel start races (unittest/imp)', () => {
    it('[MD-10.2] rejects a second start with StreamStartInProgress while the first start is still pending', async () => {
        const opened = deferred<unknown>();
        const openServiceStream = vi.fn(() => opened.promise);
        const model = makeLive(openServiceStream);

        const first = model.start(0);
        const firstOutcome = expect(first).rejects.toThrow('synthetic tuner failure');
        await vi.waitFor(() => expect(openServiceStream).toHaveBeenCalledOnce());

        await expect(model.start(1)).rejects.toThrow('StreamStartInProgress');
        expect(openServiceStream).toHaveBeenCalledOnce();

        opened.reject(new Error('synthetic tuner failure'));
        await firstOutcome;
    });

    it('[MD-10.2] closes a tuner handle that arrives after stop and rejects StreamStartStopped', async () => {
        const opened = deferred<unknown>();
        const openServiceStream = vi.fn(() => opened.promise);
        const model = makeLive(openServiceStream);
        const tuner = new PassThrough();
        const close = vi.fn();

        const starting = model.start(0);
        const startingOutcome = expect(starting).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(openServiceStream).toHaveBeenCalledOnce());
        await model.stop();

        opened.resolve({ close, stream: tuner });
        await startingOutcome;

        expect(close).toHaveBeenCalledOnce();
        expect(() => model.getStream()).toThrow('StreamIsNull');
    });

    it('[MD-10.2] stops a late HLS writer and cleans its artifacts when stop arrived during writer creation', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'epg-live-race-'));
        directories.push(directory);
        const writer = deferred<{ child: unknown; handle: unknown }>();
        const handle = Object.freeze({ kind: 'late-hls-writer' });
        const createHlsWriter = vi.fn(() => writer.promise);
        const stopHls = vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true }));
        const deleteAllFiles = vi.fn(async () => undefined);
        const logs = logger();
        const model = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: directory }) },
            { getLogger: () => logs },
            { createHlsWriter, stopHls },
            { deleteAllFiles, setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: new PassThrough() })) },
            { notifyClient: vi.fn() },
        );
        model.setOption({ channelId: 1, cmd: '%NODE%' }, 0);

        const starting = model.start(8);
        const startingOutcome = expect(starting).rejects.toThrow('StreamStartStopped');
        await vi.waitFor(() => expect(createHlsWriter).toHaveBeenCalledOnce());
        await model.stop();
        expect(stopHls).not.toHaveBeenCalled();

        writer.resolve({ child: fakeChild(), handle });
        await startingOutcome;

        expect(stopHls).toHaveBeenCalledExactlyOnceWith(handle);
        expect(deleteAllFiles).toHaveBeenCalled();
        expect(() => model.getStream()).toThrow('StreamIsNull');
    });
});
