import { describe, expect, it, vi } from 'vitest';
import { flushImmediate, makeLogger, makeReserve, makeSetter, ReserveEvent } from './_harness';

describe('event and hook characterization fixture safety', () => {
    it('[supporting downstream isolation] isolates synchronous PM failure from later hook and listener delivery', async () => {
        const logger = makeLogger();
        const reserveEvent = new ReserveEvent({ getLogger: () => logger });
        const failure = new Error('synthetic IPC notification failure');
        const externalCommandManage = {
            addUpdateReseves: vi.fn(),
            addRecordingPrepStartCmd: vi.fn(),
            addRecordingPrepRecFailedCmd: vi.fn(),
            addRecordingStartCmd: vi.fn(),
            addRecordingFailedCmd: vi.fn(),
            addRecordingFinishCmd: vi.fn(),
            addEncodingFinishCmd: vi.fn(),
        };
        const harness = makeSetter({
            logger,
            reserveEvent,
            ipc: {
                notifyClient: vi.fn(() => {
                    throw failure;
                }),
                setEncode: vi.fn(),
            },
            externalCommandManage,
        });
        harness.setter.set();
        const independentWrapperListener = vi.fn();
        reserveEvent.setUpdated(independentWrapperListener);
        const diff = { update: [makeReserve()], isSuppressLog: false };
        const originalReserve = { ...diff.update[0] };

        reserveEvent.emitUpdated(diff);

        expect(independentWrapperListener).toHaveBeenCalledOnce();
        expect(externalCommandManage.addUpdateReseves.mock.calls).toEqual([[diff]]);
        expect(diff.update[0]).toMatchObject(originalReserve);
        await flushImmediate();
        expect(logger.system.error.mock.calls).toEqual([[failure]]);
        expect(externalCommandManage.addUpdateReseves).toHaveBeenCalledOnce();
        expect(independentWrapperListener).toHaveBeenCalledOnce();
        expect(diff.update[0]).toMatchObject(originalReserve);
    });
});
