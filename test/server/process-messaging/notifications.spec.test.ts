import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeChild, makeServer } from './_harness';

const terminalEvents = ['exit', 'error', 'disconnect', 'close'] as const;

const expectNoDeliveryState = (server: any): void => {
    expect(server).not.toHaveProperty('notificationQueue');
    expect(server).not.toHaveProperty('retryQueue');
    expect(server).not.toHaveProperty('deliveryHistory');
    expect(server).not.toHaveProperty('browserDelivery');
    expect(server).not.toHaveProperty('eventHook');
};

const expectPeerReleased = (server: any, child: ReturnType<typeof makeChild>): void => {
    child.emit('disconnect');
    expect(server.child).toBeNull();
    expect(server.currentPeer).toBeNull();
    expect(child.listenerCount('message')).toBe(0);
    for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(0);
};

afterEach(() => vi.useRealTimers());

describe('SPEC-NOTIFY canonical R5 acceptance cases', () => {
    it('[PM-5.1] sends one exact notifyClient payload to the current peer and releases its peer resources', () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const child = makeChild();
        server.register(child);
        expect(server.notifyClient()).toBeUndefined();
        expect(child.send).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ type: 'notifyClient' }, expect.any(Function));
        expect(child.send.mock.calls[0][0]).not.toHaveProperty('id');
        expect(vi.getTimerCount()).toBe(0);
        expect(child.listenerCount('message')).toBe(1);
        expectNoDeliveryState(server);
        expectPeerReleased(server, child);
    });

    it('[PM-5.2] sends one exact pushEncode payload to the current peer and releases its peer resources', () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const child = makeChild();
        const option = { recordedId: 31, sourceVideoFileId: 41, parentDir: 'synthetic-root', mode: 'synthetic' };
        server.register(child);
        expect(server.setEncode(option)).toBeUndefined();
        expect(child.send).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ type: 'pushEncode', value: option }, expect.any(Function));
        expect(child.send.mock.calls[0][0]).not.toHaveProperty('id');
        expect(vi.getTimerCount()).toBe(0);
        expect(child.listenerCount('message')).toBe(1);
        expectNoDeliveryState(server);
        expectPeerReleased(server, child);
    });

    it('[PM-5.3] sends both notifications without an id, response listener, timer, or Promise', () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const child = makeChild();
        child.send.mockImplementation(() => true);
        server.register(child);

        expect(server.notifyClient()).toBeUndefined();
        expect(server.setEncode({ recordedId: 31 })).toBeUndefined();
        expect(child.send).toHaveBeenCalledTimes(2);
        expect(child.send.mock.calls.map(([, callback]) => callback)).toEqual([
            expect.any(Function),
            expect.any(Function),
        ]);
        expect(vi.getTimerCount()).toBe(0);
        expect(child.listenerCount('message')).toBe(1);
        expect(server).not.toHaveProperty('pending');
        expect(server).not.toHaveProperty('responsePromises');
        expectNoDeliveryState(server);
        expectPeerReleased(server, child);
    });

    it('[PM-5.4] preserves no-recipient, synchronous, and callback failure contracts without retry', () => {
        const noRecipient = makeServer();
        expect(noRecipient.server.notifyClient()).toBeUndefined();
        expect(() => noRecipient.server.setEncode({ recordedId: 31 })).toThrow('ChildIsNull');
        expect(noRecipient.logError).toHaveBeenCalledOnce();
        expect(noRecipient.logError).toHaveBeenCalledWith(
            'IPC notification discarded: notification recipient is unavailable',
        );

        const notifySync = makeServer();
        const notifySyncChild = makeChild();
        notifySyncChild.send.mockImplementation(() => {
            throw new Error('notify synchronous failure');
        });
        notifySync.server.register(notifySyncChild);
        expect(notifySync.server.notifyClient()).toBeUndefined();
        expect(notifySync.logError).toHaveBeenCalledWith('IPC notification discarded: notify synchronous failure');

        const pushSync = makeServer();
        const pushSyncChild = makeChild();
        const pushSyncFailure = new Error('push synchronous failure');
        pushSyncChild.send.mockImplementation(() => {
            throw pushSyncFailure;
        });
        pushSync.server.register(pushSyncChild);
        expect(() => pushSync.server.setEncode({ recordedId: 31 })).toThrow(pushSyncFailure);
        expect(pushSync.logError).not.toHaveBeenCalled();

        const notifyCallback = makeServer();
        const notifyCallbackChild = makeChild();
        notifyCallbackChild.send.mockImplementation((_message, callback) => {
            callback(new Error('notify callback failure'));
            return true;
        });
        notifyCallback.server.register(notifyCallbackChild);
        expect(notifyCallback.server.notifyClient()).toBeUndefined();
        expect(notifyCallback.logError).toHaveBeenCalledWith('IPC notification discarded: notify callback failure');

        const pushCallback = makeServer();
        const pushCallbackChild = makeChild();
        pushCallbackChild.send.mockImplementation((_message, callback) => {
            callback(new Error('push callback failure'));
            return true;
        });
        pushCallback.server.register(pushCallbackChild);
        expect(pushCallback.server.setEncode({ recordedId: 31 })).toBeUndefined();
        expect(pushCallback.logError).toHaveBeenCalledWith('IPC notification discarded: push callback failure');

        expectNoDeliveryState(noRecipient.server);
        expectNoDeliveryState(notifySync.server);
        expectNoDeliveryState(pushSync.server);
        expectNoDeliveryState(notifyCallback.server);
        expectNoDeliveryState(pushCallback.server);
        expectPeerReleased(notifySync.server, notifySyncChild);
        expectPeerReleased(pushSync.server, pushSyncChild);
        expectPeerReleased(notifyCallback.server, notifyCallbackChild);
        expectPeerReleased(pushCallback.server, pushCallbackChild);
    });
});

describe('reverse IPC notification sender supporting contracts', () => {
    it('[NO-DELIVERY-STATE] sends only to the current child and neither stores nor replays old notifications', () => {
        const { server } = makeServer();
        const first = makeChild();
        const current = makeChild();
        server.register(first);
        server.register(current);
        server.notifyClient();
        server.setEncode({ recordedId: 32 });
        expect(first.send).not.toHaveBeenCalled();
        expect(current.send.mock.calls.map(([message]) => message)).toEqual([
            { type: 'notifyClient' },
            { type: 'pushEncode', value: { recordedId: 32 } },
        ]);
        expectNoDeliveryState(server);
        expectPeerReleased(server, current);
    });
});
