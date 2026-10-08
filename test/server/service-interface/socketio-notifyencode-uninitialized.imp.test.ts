import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled, require } from './_harness';

const SocketIOManageModel = (require(compiled('model', 'service', 'socketio', 'SocketIOManageModel.js')) as {
    default: new (...args: unknown[]) => {
        notifyUpdateEncodeProgress(): void;
    };
}).default;

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Real SocketIOManageModel.notifyUpdateEncodeProgress uninitialized throw (L77–79).
 * Without initialize, public notifyUpdateEncodeProgress schedules 200ms; timer rejects must call SocketIoManageModel initialize.
 * emit failure handling is out of scope.
 */
describe('SocketIOManageModel.notifyUpdateEncodeProgress uninitialized (unittest/imp)', () => {
    it('[R2-SOCKETIO-NOTIFYENCODE-UNINIT] notifyUpdateEncodeProgress timer rejects when ios is empty', async () => {
        vi.useFakeTimers();
        const model = new SocketIOManageModel(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: () => ({}) },
        );

        model.notifyUpdateEncodeProgress();
        await expect(vi.advanceTimersByTimeAsync(200)).rejects.toThrow('must call SocketIoManageModel initialize');
    });
});
