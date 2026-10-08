import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, deferred, fakeChild, logger } from './_media-harness';

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;

const settleMicrotasks = async (): Promise<void> => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
};

const createLive = () =>
    new LiveStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: logger },
        { create: async () => fakeChild() },
        { deleteAllFiles: async () => undefined, setOption: () => undefined },
        {},
        { notifyClient: () => undefined },
    ) as any;

describe('live stream implementation characterization', () => {
    it('[MD-1.3] uses no process option for commandless M2TS and a process option only when configured', () => {
        const live = createLive();
        live.setOption({ channelId: 101 }, 0);
        expect(live.createProcessOption(3)).toBeNull();
        live.setOption({ channelId: 101, cmd: '%FFMPEG% -i %INPUT%' }, 1);
        expect(live.createProcessOption(3)).toEqual({
            cmd: 'synthetic-ffmpeg -i %INPUT%',
            input: null,
            output: null,
            priority: 1,
        });
    });

    it('[MD-1.9] exposes a settled readable without adding a body-duration timeout', () => {
        const live = createLive();
        const child = fakeChild();
        live.streamProcess = child;
        expect(live.getStream()).toBe(child.stdout);
        expect(live).not.toHaveProperty('startDeadline');
    });

    it('[MD-1.6][MD-6.1] preserves the stdin failure while releasing the managed handle before the tuner', async () => {
        const events: string[] = [];
        const tuner = new PassThrough();
        const close = vi.fn(() => {
            events.push('tuner:close');
            tuner.destroy();
        });
        const child = fakeChild();
        child.stdin = null;
        const handle = Object.freeze({ kind: 'managed-live-stdin' });
        const stopFailure = new Error('synthetic managed stop failure');
        const processManager = {
            createManaged: vi.fn(async () => ({ child, handle })),
            requestStop: vi.fn(async () => {
                events.push('process:stop');
                throw stopFailure;
            }),
        };
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-stdin' }, 0);

        await expect(live.start(0)).rejects.toThrow('StreamProcessStdinIsNull');

        expect(processManager.requestStop).toHaveBeenCalledOnce();
        expect(processManager.requestStop).toHaveBeenCalledWith(handle);
        expect(close).toHaveBeenCalledOnce();
        expect(events).toEqual(['process:stop', 'tuner:close']);
    });

    it('[MD-1.6] returns a managed-start failure after closing the already acquired tuner', async () => {
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const failure = new Error('synthetic managed start failure');
        const processManager = {
            createManaged: vi.fn(async () => Promise.reject(failure)),
            requestStop: vi.fn(),
        };
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-start-failure' }, 0);

        await expect(live.start(0)).rejects.toBe(failure);

        expect(processManager.requestStop).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
    });

    it('[MD-1.6] retains the opaque managed handle through an instant process terminal', async () => {
        const events: string[] = [];
        const tuner = new PassThrough();
        const close = vi.fn(() => {
            events.push('tuner:close');
            tuner.destroy();
        });
        const child = fakeChild();
        child.exitCode = 1;
        const handle = Object.freeze({ kind: 'managed-live-instant-terminal' });
        const processManager = {
            createManaged: vi.fn(async () => ({ child, handle })),
            requestStop: vi.fn(async () => {
                events.push('process:stop');
                return { sentSignals: ['SIGINT'], status: 'requested' };
            }),
        };
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-instant-terminal' }, 0);
        live.setExitStream(() => {
            void live.stop();
        });

        await expect(live.start(0)).rejects.toThrow('StreamStartStopped');

        expect(processManager.requestStop).toHaveBeenCalledOnce();
        expect(processManager.requestStop).toHaveBeenCalledWith(handle);
        expect(close).toHaveBeenCalledOnce();
        expect(events).toEqual(['process:stop', 'tuner:close']);
    });

    it('[MD-1.8] stops a late managed handle before accepting a later delivery session', async () => {
        const firstTuner = new PassThrough();
        const secondTuner = new PassThrough();
        const firstClose = vi.fn(() => firstTuner.destroy());
        const secondClose = vi.fn(() => secondTuner.destroy());
        const firstProcess = deferred<any>();
        const firstChild = fakeChild();
        const secondChild = fakeChild();
        const firstHandle = Object.freeze({ kind: 'managed-live-late' });
        const secondHandle = Object.freeze({ kind: 'managed-live-current' });
        const requestStop = vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' }));
        const processManager = {
            createManaged: vi
                .fn()
                .mockImplementationOnce(() => firstProcess.promise)
                .mockImplementationOnce(async () => ({ child: secondChild, handle: secondHandle })),
            requestStop,
        };
        const openServiceStream = vi
            .fn()
            .mockImplementationOnce(async () => ({ close: firstClose, stream: firstTuner }))
            .mockImplementationOnce(async () => ({ close: secondClose, stream: secondTuner }));
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-late' }, 0);

        const firstStart = live.start(0);
        await settleMicrotasks();
        await live.stop();
        firstProcess.resolve({ child: firstChild, handle: firstHandle });

        await expect(firstStart).rejects.toThrow('StreamStartStopped');
        expect(requestStop).toHaveBeenCalledOnce();
        expect(requestStop).toHaveBeenCalledWith(firstHandle);
        await live.start(1);
        expect(live.getStream()).toBe(secondChild.stdout);

        await live.stop();
        expect(requestStop).toHaveBeenCalledTimes(2);
        expect(requestStop).toHaveBeenLastCalledWith(secondHandle);
        expect(firstClose).toHaveBeenCalledOnce();
        expect(secondClose).toHaveBeenCalledOnce();
    });

    it('[MD-1.8] ignores a late tuner rejection before a later commandless delivery starts', async () => {
        const firstTuner = deferred<any>();
        const firstFailure = new Error('synthetic late tuner failure');
        const secondTuner = new PassThrough();
        const secondClose = vi.fn(() => secondTuner.destroy());
        const openServiceStream = vi
            .fn()
            .mockImplementationOnce(() => firstTuner.promise)
            .mockImplementationOnce(async () => ({ close: secondClose, stream: secondTuner }));
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { create: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101 }, 0);

        const firstStart = live.start(0);
        await settleMicrotasks();
        await live.stop();
        firstTuner.reject(firstFailure);

        await expect(firstStart).rejects.toBe(firstFailure);
        await live.start(1);
        expect(live.getStream()).toBe(secondTuner);

        await live.stop();
        expect(secondClose).toHaveBeenCalledOnce();
    });

    it('[MD-10.2] delivers one terminal callback when a commandless live tuner ends after startup', async () => {
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const exited = vi.fn();
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged: vi.fn(), requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101 }, 0);
        live.setExitStream(exited);

        await live.start(0);
        tuner.end();
        tuner.resume();
        await vi.waitFor(() => expect(exited).toHaveBeenCalledOnce());

        await live.stop();
        expect(close).toHaveBeenCalledOnce();
    });

    it.each([
        ['commandless', undefined],
        ['converted', '%NODE% synthetic-live-terminal'],
    ])('[MD-1.6] rejects an already terminal %s tuner stream and closes its handle once', async (_name, cmd) => {
        const tuner = new PassThrough();
        tuner.destroy();
        const close = vi.fn();
        const exited = vi.fn();
        const createManaged = vi.fn(async () => ({
            child: fakeChild(),
            handle: Object.freeze({ kind: 'managed-live-terminal' }),
        }));
        const requestStop = vi.fn();
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        live.setOption(cmd === undefined ? { channelId: 101 } : { channelId: 101, cmd }, 0);
        live.setExitStream(exited);

        await expect(live.start(0)).rejects.toThrow('TunerStreamIsTerminal');

        expect(exited).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(createManaged).not.toHaveBeenCalled();
        expect(requestStop).not.toHaveBeenCalled();
    });

    it('[MD-1.6] rejects a readable-ended converted tuner stream and closes its handle once', async () => {
        const tuner = Readable.from([], { autoDestroy: false });
        tuner.resume();
        await once(tuner, 'end');
        expect(tuner.destroyed).toBe(false);
        expect(tuner.readableEnded).toBe(true);

        const close = vi.fn();
        const exited = vi.fn();
        const createManaged = vi.fn();
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            { createManaged, requestStop: vi.fn() },
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101, cmd: '%NODE% synthetic-live-ended' }, 0);
        live.setExitStream(exited);

        await expect(live.start(0)).rejects.toThrow('TunerStreamIsTerminal');

        expect(exited).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(createManaged).not.toHaveBeenCalled();
    });
});
