import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;

/**
 * Real LiveStreamBaseModel/StreamBaseModel guard clauses that the public `start()` flow
 * always satisfies before reaching them (setOption is always called first in every existing
 * test, and setMirakurunStream always either sets a real stream or throws before returning).
 * Each guard is reachable only by calling the (compiled, plain-JS-accessible) protected/private
 * method directly against a state the public API never produces on its own.
 */
const createModel = () => {
    const log = logger();
    const openServiceStream = vi.fn();
    const createManaged = vi.fn();
    const model = new LiveStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: () => log },
        { createManaged },
        { deleteAllFiles: vi.fn(), setOption: vi.fn() },
        { openServiceStream },
        { notifyClient: vi.fn() },
    );
    return { createManaged, log, model, openServiceStream };
};

describe('LiveStreamBaseModel guard direct calls (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[R2-LIVE-CREATEPROCESSOPTION-NULL] createProcessOption throws before any option is set (L100–102)', () => {
        const { model } = createModel();
        expect(() => model.createProcessOption(1)).toThrow('ProcessOptionIsNull');
    });

    it('[R2-LIVE-STARTSESSION-NULL] start() rejects before any option is set (L153–155)', async () => {
        const { model } = createModel();
        await expect(model.start(1)).rejects.toThrow('ProcessOptionIsNull');
    });

    it('[R2-LIVE-SETMIRAKURUNSTREAM-NULL] setMirakurunStream throws before any option is set (L356–358)', async () => {
        const { model } = createModel();
        await expect(
            model.setMirakurunStream(baseConfig(), {
                finalizer: null,
                hlsStopFinalization: null,
                hlsWriterHandle: null,
                id3MetadataTransform: null,
                managedProcessHandle: null,
                ownedListeners: [],
                stopped: false,
                stream: null,
                streamProcess: null,
                token: {},
                tunerStreamHandle: null,
            }),
        ).rejects.toThrow('ProcessOptionIsNull');
    });

    it('[R2-LIVE-SETSTREAMERROR] start() rejects when the receive stage leaves the session stream unset (L167–169)', async () => {
        const { model } = createModel();
        model.setOption({ channelId: 101 }, 0);
        model.setMirakurunStream = vi.fn(async (_config: unknown, session: { stream: unknown }) => {
            session.stream = null;
        });

        await expect(model.start(0)).rejects.toThrow('SetStreamError');
    });

    it('[R2-LIVE-CREATESTREAMPROCESSERROR] start() rejects when the managed process yields no child (L266–268)', async () => {
        const { createManaged, model, openServiceStream } = createModel();
        const tuner = new PassThrough();
        openServiceStream.mockResolvedValue({ close: vi.fn(), stream: tuner });
        createManaged.mockResolvedValue({ child: null, handle: Object.freeze({ kind: 'null-child-handle' }) });
        model.setOption({ channelId: 101, cmd: '%NODE% synthetic' }, 0);

        await expect(model.start(0)).rejects.toThrow('CreateStreamProcessError');
    });

    it('[R2-LIVE-GETINFO-PROCESSOPTION-NULL] getInfo throws before any option is set (L538–540)', () => {
        const { model } = createModel();
        expect(() => model.getInfo()).toThrow('ProcessOptionIsNull');
    });

    it('[R2-LIVE-GETINFO-CONFIGMODE-NULL] getInfo throws when processOption is set without going through setOption (L542–544)', () => {
        const { model } = createModel();
        // setOption always assigns processOption and configMode together; bypass it to reach the
        // defensive invariant check that configMode is still set.
        model.processOption = { channelId: 101 };

        expect(() => model.getInfo()).toThrow('ConfigModeIsNull');
    });
});
