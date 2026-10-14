import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeChild, makeClient, makeServer } from './_harness';

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

    it('[PM-5.2] hands setEncode to the queue store and sends one exact pushEncode payload with its encodeId to the current peer', () => {
        vi.useFakeTimers();
        const { domains, server } = makeServer();
        const child = makeChild();
        const option = { recordedId: 31, sourceVideoFileId: 41, parentDir: 'synthetic-root', mode: 'synthetic' };
        server.register(child);

        expect(server.setEncode(option)).toBeUndefined();
        expect(domains.encodeQueue.enqueueFromRecording).toHaveBeenCalledExactlyOnceWith(option, expect.any(Function));
        expect(child.send).not.toHaveBeenCalled();

        const sender = domains.encodeQueue.enqueueFromRecording.mock.calls[0][1];
        expect(sender(51, option)).toBe(true);
        expect(child.send).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith(
            { encodeId: 51, type: 'pushEncode', value: option },
            expect.any(Function),
        );
        expect(child.send.mock.calls[0][0]).not.toHaveProperty('id');

        expect(server.pushEncode(52, option)).toBe(true);
        expect(child.send).toHaveBeenCalledTimes(2);
        expect(child.send).toHaveBeenLastCalledWith(
            { encodeId: 52, type: 'pushEncode', value: option },
            expect.any(Function),
        );
        expect(domains.encodeQueue.enqueueFromRecording).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(child.listenerCount('message')).toBe(1);
        expectNoDeliveryState(server);
        expectPeerReleased(server, child);
    });

    it('[PM-5.2] hands the encode request to the child-owned pushPersisted port with its encodeId', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            const option = { mode: 'synthetic', recordedId: 31 };
            await harness.receive({ encodeId: 61, type: 'pushEncode', value: option });

            expect(harness.encodePushPersisted).toHaveBeenCalledExactlyOnceWith(61, option);
            expect(harness.encodePush).not.toHaveBeenCalled();
            expect(harness.send).not.toHaveBeenCalled();
            expect(harness.logError).not.toHaveBeenCalled();
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });

    it('[PM-5.3] sends both notifications without an id, response listener, timer, or Promise', () => {
        vi.useFakeTimers();
        const { server } = makeServer();
        const child = makeChild();
        child.send.mockImplementation(() => true);
        server.register(child);

        expect(server.notifyClient()).toBeUndefined();
        expect(server.pushEncode(31, { recordedId: 31 })).toBe(true);
        expect(child.send).toHaveBeenCalledTimes(2);
        for (const [message] of child.send.mock.calls) expect(message).not.toHaveProperty('id');
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

    it('[PM-5.4] records and discards no-recipient, synchronous, and callback failures for both notification kinds without retry', () => {
        const noRecipient = makeServer();
        expect(noRecipient.server.notifyClient()).toBeUndefined();
        expect(noRecipient.logError).toHaveBeenCalledOnce();
        expect(noRecipient.logError).toHaveBeenLastCalledWith(
            'IPC notification discarded: notification recipient is unavailable',
        );
        expect(noRecipient.server.pushEncode(31, { recordedId: 31 })).toBe(false);
        expect(noRecipient.logError).toHaveBeenCalledTimes(2);
        expect(noRecipient.logError).toHaveBeenLastCalledWith(
            'IPC notification discarded: notification recipient is unavailable',
        );
        // 通知先が無くても、依頼は記録窓口へ渡して同期で戻る（記録は窓口が残す）。
        expect(noRecipient.server.setEncode({ recordedId: 32 })).toBeUndefined();
        expect(noRecipient.domains.encodeQueue.enqueueFromRecording).toHaveBeenCalledExactlyOnceWith(
            { recordedId: 32 },
            expect.any(Function),
        );
        expect(noRecipient.domains.encodeQueue.enqueueFromRecording.mock.calls[0][1](33, { recordedId: 32 })).toBe(
            false,
        );
        expect(noRecipient.logError).toHaveBeenCalledTimes(3);
        expect(noRecipient.logError).toHaveBeenLastCalledWith(
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
        expect(pushSync.server.pushEncode(31, { recordedId: 31 })).toBe(false);
        expect(pushSyncChild.send).toHaveBeenCalledOnce();
        expect(pushSync.logError).toHaveBeenCalledExactlyOnceWith(
            'IPC notification discarded: push synchronous failure',
        );

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
        expect(pushCallback.server.pushEncode(31, { recordedId: 31 })).toBe(true);
        expect(pushCallbackChild.send).toHaveBeenCalledOnce();
        expect(pushCallback.logError).toHaveBeenCalledExactlyOnceWith(
            'IPC notification discarded: push callback failure',
        );

        // 依頼記録窓口が組み立てられていない場合だけ、setEncode は同期で失敗を返す（通知は送らない）。
        const noStore = makeServer({ withEncodeQueueStore: false });
        const noStoreChild = makeChild();
        noStore.server.register(noStoreChild);
        expect(() => noStore.server.setEncode({ recordedId: 31 })).toThrow('EncodeQueueStoreNotRegistered');
        expect(noStoreChild.send).not.toHaveBeenCalled();
        expectPeerReleased(noStore.server, noStoreChild);

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
        expect(server.pushEncode(32, { recordedId: 32 })).toBe(true);
        expect(first.send).not.toHaveBeenCalled();
        expect(current.send.mock.calls.map(([message]) => message)).toEqual([
            { type: 'notifyClient' },
            { encodeId: 32, type: 'pushEncode', value: { recordedId: 32 } },
        ]);
        expectNoDeliveryState(server);
        expectPeerReleased(server, current);
    });
});
