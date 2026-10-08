import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const IPCServer = (
    require(join(snapshot, 'model/ipc/IPCServer.js')) as {
        default: new (...dependencies: unknown[]) => {
            register(child: EventEmitter): void;
        };
    }
).default;

interface SyntheticChild extends EventEmitter {
    readonly send: ReturnType<typeof vi.fn>;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

const makeChild = (): SyntheticChild => {
    const child = new EventEmitter() as SyntheticChild;
    Object.assign(child, { send: vi.fn() });
    return child;
};

const defer = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('parent video file deletion composition', () => {
    it('[WC-5.4][WC-5.12] preserves the recorded.deleteVideoFile wire while turning an initial whole decision into fresh whole deletion', async () => {
        const wholeToken = Object.freeze(Object.create(null));
        const recorded = {
            deletePrepared: vi.fn(async () => undefined),
            deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
            deleteVideoFile: vi.fn(async () => undefined),
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: false,
                reserveId: null,
                status: 'prepared' as const,
                token: wholeToken,
            })),
            prepareVideoFileDeletion: vi.fn(async () => ({
                recordedId: 722,
                status: 'whole-recorded-deletion-required' as const,
            })),
        };
        const recording = {
            cancelForDeletion: vi.fn(async () => undefined),
            hasReserve: vi.fn(() => false),
        };
        const server = new IPCServer({}, recorded, {}, recording, {}, {}, undefined, {});
        const requester = makeChild();
        server.register(requester);

        requester.emit('message', { args: { videoFileId: 721 }, func: 'deleteVideoFile', id: 721, model: 'recorded' });
        await vi.waitFor(() => expect(recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(wholeToken));

        expect(recorded.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(721);
        expect(recorded.deletePreparedVideoFile).not.toHaveBeenCalled();
        expect(recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(722);
        expect(recorded.deletePrepared.mock.calls[0][0]).toBe(wholeToken);
        expect(recorded.deleteVideoFile).not.toHaveBeenCalled();
        expect(recording.hasReserve).not.toHaveBeenCalled();
        expect(recording.cancelForDeletion).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(requester.send).toHaveBeenCalledExactlyOnceWith({ id: 721, result: undefined }));
        requester.emit('close');
    });

    it('[WC-5.4][WC-5.10][WC-5.12] preserves the wire while a final whole decision waits at its fresh whole terminal barrier', async () => {
        const videoToken = Object.freeze(Object.create(null));
        const wholeToken = Object.freeze(Object.create(null));
        const cancellation = defer<void>();
        const recorded = {
            deletePrepared: vi.fn(async () => undefined),
            deletePreparedVideoFile: vi.fn(async () => ({
                recordedId: 725,
                status: 'whole-recorded-deletion-required' as const,
            })),
            deleteVideoFile: vi.fn(async () => undefined),
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: true,
                reserveId: 726,
                status: 'prepared' as const,
                token: wholeToken,
            })),
            prepareVideoFileDeletion: vi.fn(async () => ({ status: 'prepared' as const, token: videoToken })),
        };
        const recording = {
            cancelForDeletion: vi.fn(() => cancellation.promise),
            hasReserve: vi.fn(() => true),
        };
        const server = new IPCServer({}, recorded, {}, recording, {}, {}, undefined, {});
        const requester = makeChild();
        server.register(requester);

        requester.emit('message', { args: { videoFileId: 724 }, func: 'deleteVideoFile', id: 724, model: 'recorded' });
        await vi.waitFor(() => expect(recording.cancelForDeletion).toHaveBeenCalledExactlyOnceWith(726));

        expect(recorded.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(724);
        expect(recorded.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(videoToken);
        expect(recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(725);
        expect(recorded.deletePrepared).not.toHaveBeenCalled();
        expect(recorded.deleteVideoFile).not.toHaveBeenCalled();
        expect(requester.send).not.toHaveBeenCalled();

        cancellation.resolve(undefined);
        await vi.waitFor(() => expect(recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(wholeToken));

        expect(recorded.deletePrepared.mock.calls[0][0]).toBe(wholeToken);
        expect(recording.hasReserve).toHaveBeenCalledExactlyOnceWith(726);
        expect(recorded.prepareVideoFileDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            recorded.deletePreparedVideoFile.mock.invocationCallOrder[0],
        );
        expect(recorded.deletePreparedVideoFile.mock.invocationCallOrder[0]).toBeLessThan(
            recorded.prepareUserDeletion.mock.invocationCallOrder[0],
        );
        expect(recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            recording.cancelForDeletion.mock.invocationCallOrder[0],
        );
        expect(recording.cancelForDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            recorded.deletePrepared.mock.invocationCallOrder[0],
        );
        await vi.waitFor(() => expect(requester.send).toHaveBeenCalledExactlyOnceWith({ id: 724, result: undefined }));
        requester.emit('close');
    });
});
