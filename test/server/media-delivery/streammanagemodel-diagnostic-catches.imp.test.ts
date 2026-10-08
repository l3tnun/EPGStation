import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, executionManager, fakeStream, logger } from './_media-harness';

const StreamManageModel = compiled<any>('model', 'service', 'stream', 'manager', 'StreamManageModel.js').default;

describe('StreamManageModel diagnostic catches (unittest/imp)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('[R2-STREAMMANAGE-LOGSTREAMINFO-CATCH] does not propagate when the stop-stream info logger itself throws (L798–800)', async () => {
        const log = logger();
        const manager = new StreamManageModel({ getLogger: () => log }, executionManager(), { notifyClient: vi.fn() });
        const stream = fakeStream({ type: 'RecordedStream' });

        await expect(manager.start(stream)).resolves.toBe(0);
        // start() itself logs 'start stream: 0' through the un-wrapped `this.log.stream.info`
        // call (L409), so the throwing logger is only installed once that has already happened.
        const boom = new Error('synthetic-log-stream-info-failure');
        log.stream.info.mockImplementation(() => {
            throw boom;
        });

        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(log.stream.info).toHaveBeenCalledWith('stop stream 0');
    });

    it("[R2-STREAMMANAGE-RESOURCELEASEBUNDLE-ONERROR-CATCH] absorbs a disposer's onError diagnostic itself throwing (L116–118)", async () => {
        const log = logger();
        const manager = new StreamManageModel({ getLogger: () => log }, executionManager(), { notifyClient: vi.fn() });
        const stream = fakeStream({ type: 'RecordedStream' });
        const disposerFailure = new Error('synthetic-resource-disposer-failure');
        stream.stop.mockRejectedValue(disposerFailure);

        await expect(manager.start(stream)).resolves.toBe(0);

        // logStreamError has its own internal catch (see HLSFileDeleterModel.logStream and
        // StreamBaseModel.logHlsError for the same shape), so the ResourceLeaseBundle disposer's
        // onError callback -- which calls logStreamError with the message and then the error --
        // never actually throws through a real logger. Spying on the instance method directly is
        // what actually exercises disposeAll's own outer catch around `this.onError(error)`: the
        // very first logStreamError call now throws, aborting onError before its second call.
        const logStreamErrorFailure = new Error('synthetic-log-stream-error-spy-failure');
        vi.spyOn(manager, 'logStreamError').mockImplementation(() => {
            throw logStreamErrorFailure;
        });

        await expect(manager.stop(0)).resolves.toBeUndefined();

        expect(stream.stop).toHaveBeenCalledOnce();
        expect(manager.logStreamError).toHaveBeenCalledExactlyOnceWith('stop stream error 0');
    });
});
