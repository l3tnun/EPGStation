import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, require } from '../_harness';

const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as any)
    .default;

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('Socket.IO status destination failure isolation [SI-7.3]', () => {
    it('resets the timer before delivery, logs one synchronous failure, and continues without an unhandled timer error', async () => {
        vi.useFakeTimers();

        const failure = new Error('synchronous emit failure');
        const logError = vi.fn();
        const logFatal = vi.fn();
        const model = new SocketIOManageModel(
            {
                getLogger: () => ({
                    system: {
                        error: logError,
                        fatal: logFatal,
                    },
                }),
            },
            {
                getConfig: () => ({}),
            },
        );
        let callTimer = model.callTimer;
        let timerResetCount = 0;
        Object.defineProperty(model, 'callTimer', {
            configurable: true,
            get: () => callTimer,
            set: (value: unknown) => {
                if (value === null) timerResetCount += 1;
                callTimer = value;
            },
        });
        let timerWasResetBeforeDelivery = false;
        const failingEmit = vi.fn(() => {
            timerWasResetBeforeDelivery = model.callTimer === null;
            throw failure;
        });
        const laterEmit = vi.fn();
        model.ios = [{ sockets: { emit: failingEmit } }, { sockets: { emit: laterEmit } }];

        model.notifyClient();

        await vi.advanceTimersByTimeAsync(200);
        expect(timerWasResetBeforeDelivery).toBe(true);
        expect(timerResetCount).toBe(1);
        expect(failingEmit.mock.calls).toEqual([['updateStatus']]);
        expect(laterEmit.mock.calls).toEqual([['updateStatus']]);
        expect(logError).toHaveBeenCalledOnce();
        expect(logError).toHaveBeenCalledWith(failure);
        expect(logFatal).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('Socket.IO encode destination failure isolation [SI-7.4]', () => {
    it('resets only the encode timer, logs one synchronous failure, and continues without an unhandled timer error', async () => {
        vi.useFakeTimers();

        const failure = new Error('synchronous encode emit failure');
        const logError = vi.fn();
        const logFatal = vi.fn();
        const model = new SocketIOManageModel(
            {
                getLogger: () => ({
                    system: {
                        error: logError,
                        fatal: logFatal,
                    },
                }),
            },
            {
                getConfig: () => ({}),
            },
        );
        let encodeTimer = model.encodeProgressCallTimer;
        let encodeTimerResetCount = 0;
        Object.defineProperty(model, 'encodeProgressCallTimer', {
            configurable: true,
            get: () => encodeTimer,
            set: (value: unknown) => {
                if (value === null) encodeTimerResetCount += 1;
                encodeTimer = value;
            },
        });
        let encodeTimerWasResetBeforeDelivery = false;
        let statusTimerAtDelivery: unknown;
        let expectedStatusTimer: unknown;
        const failingEmit = vi.fn(() => {
            encodeTimerWasResetBeforeDelivery = model.encodeProgressCallTimer === null;
            statusTimerAtDelivery = model.callTimer;
            throw failure;
        });
        const laterEmit = vi.fn();
        model.ios = [{ sockets: { emit: failingEmit } }, { sockets: { emit: laterEmit } }];

        model.notifyUpdateEncodeProgress();
        await vi.advanceTimersByTimeAsync(100);
        model.notifyClient();
        expectedStatusTimer = model.callTimer;

        await vi.advanceTimersByTimeAsync(100);
        expect(encodeTimerWasResetBeforeDelivery).toBe(true);
        expect(encodeTimerResetCount).toBe(1);
        expect(statusTimerAtDelivery).toBe(expectedStatusTimer);
        expect(model.callTimer).toBe(expectedStatusTimer);
        expect(failingEmit.mock.calls).toEqual([['updateEncode']]);
        expect(laterEmit.mock.calls).toEqual([['updateEncode']]);
        expect(logError).toHaveBeenCalledOnce();
        expect(logError).toHaveBeenCalledWith(failure);
        expect(logFatal).not.toHaveBeenCalled();
        expect(model.encodeProgressCallTimer).toBeNull();
        expect(vi.getTimerCount()).toBe(1);
    });
});
