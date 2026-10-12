import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { makeChild, makeServer } from '../process-messaging/_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const EncodeEvent = load<new (...dependencies: unknown[]) => { emitter: EventEmitter }>('model/event/EncodeEvent.js');
const EncodeManageModel = load<
    new (...dependencies: unknown[]) => {
        cancel(encodeId: number): Promise<void>;
        cancelEncodeByRecordedId(recordedId: number): Promise<void>;
        runningQueue: Array<{ getEncodeOption(): { encodeId: number; recordedId: number } | null }>;
        waitQueue: Array<{ getEncodeOption(): { encodeId: number; recordedId: number } | null }>;
        listener: EventEmitter;
    }
>('model/service/encode/EncodeManageModel.js');
const ParentUserDeletionCoordinator = load<
    new (
        deletion: {
            prepareUserDeletion(recordedId: number): Promise<unknown>;
            deletePrepared(token: object): Promise<void>;
        },
        recording: {
            hasReservation(reserveId: number): boolean;
            requestCancellationForDeletion(reserveId: number): Promise<void>;
        },
    ) => { deleteFromRequest(recordedId: number): Promise<void> }
>('model/workflow/ParentUserDeletionCoordinator.js');
const ServiceChildUserDeletionCoordinator = load<
    new (
        encoding: { cancelEncodeByRecordedId(recordedId: number): Promise<void> },
        request: { requestUserDeletion(recordedId: number): Promise<void> },
    ) => { deleteByUser(recordedId: number): Promise<void> }
>('model/workflow/ServiceChildUserDeletionCoordinator.js');

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
    let resolve!: Deferred<T>['resolve'];
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('user deletion cancellation integration', () => {
    it('[WC-5.1][WC-7.3] attempts every matching Encode cancellation before rejecting without crossing the parent boundary', async () => {
        const recordedId = 631;
        const failedEncodeId = 632;
        const cancellationFailure = new Error('synthetic Encode cancellation failure');
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const encoding = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
            {
                getExecution: vi.fn(async () => 'synthetic-cancellation-execution'),
                unLockExecution: vi.fn(),
            },
            vi.fn(),
            event,
        );
        encoding.waitQueue = [
            { getEncodeOption: () => ({ encodeId: 633, recordedId }) },
            { getEncodeOption: () => ({ encodeId: 635, recordedId: recordedId + 1 }) },
            { getEncodeOption: () => null },
        ];
        encoding.runningQueue = [
            { getEncodeOption: () => ({ encodeId: failedEncodeId, recordedId }) },
            { getEncodeOption: () => ({ encodeId: 634, recordedId }) },
            { getEncodeOption: () => ({ encodeId: 636, recordedId: recordedId + 1 }) },
        ];
        const cancelled: number[] = [];
        vi.spyOn(encoding, 'cancel').mockImplementation(async encodeId => {
            cancelled.push(encodeId);
            if (encodeId === failedEncodeId) throw cancellationFailure;
        });
        const deletion = {
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: false,
                reserveId: null,
                status: 'prepared' as const,
                token: Object.freeze(Object.create(null)),
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const parent = new ParentUserDeletionCoordinator(deletion, recording);
        const outbound = { requestUserDeletion: vi.fn(recordedId => parent.deleteFromRequest(recordedId)) };
        const child = new ServiceChildUserDeletionCoordinator(encoding, outbound);

        try {
            await expect(child.deleteByUser(recordedId)).rejects.toMatchObject({ message: 'StopEncodeError' });

            expect(cancelled).toEqual([633, failedEncodeId, 634]);
            expect(outbound.requestUserDeletion).not.toHaveBeenCalled();
            expect(deletion.prepareUserDeletion).not.toHaveBeenCalled();
            expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
            expect(deletion.deletePrepared).not.toHaveBeenCalled();
        } finally {
            encoding.listener.removeAllListeners();
            event.emitter.removeAllListeners();
        }
    });

    it('[PRIMARY WC-5.1][PRIMARY WC-5.2][WC-5.1][WC-5.2] waits for every matching actual Encode cancellation before crossing the parent boundary once', async () => {
        const recordedId = 641;
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const encoding = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
            {
                getExecution: vi.fn(async () => 'synthetic-successful-cancellation-execution'),
                unLockExecution: vi.fn(),
            },
            vi.fn(),
            event,
        );
        const cancellationGates = new Map<number, Deferred<void>>([
            [642, deferred<void>()],
            [643, deferred<void>()],
            [644, deferred<void>()],
        ]);
        encoding.waitQueue = [
            { getEncodeOption: () => ({ encodeId: 642, recordedId }) },
            { getEncodeOption: () => ({ encodeId: 645, recordedId: recordedId + 1 }) },
            { getEncodeOption: () => null },
        ];
        encoding.runningQueue = [
            { getEncodeOption: () => ({ encodeId: 643, recordedId }) },
            { getEncodeOption: () => ({ encodeId: 644, recordedId }) },
            { getEncodeOption: () => ({ encodeId: 646, recordedId: recordedId + 1 }) },
            { getEncodeOption: () => null },
        ];
        const cancelled: number[] = [];
        vi.spyOn(encoding, 'cancel').mockImplementation(encodeId => {
            cancelled.push(encodeId);
            const gate = cancellationGates.get(encodeId);
            if (gate === undefined) throw new Error(`unexpected Encode cancellation: ${encodeId}`);
            return gate.promise;
        });
        const deletion = {
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: false,
                reserveId: null,
                status: 'prepared' as const,
                token: Object.freeze(Object.create(null)),
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const parent = new ParentUserDeletionCoordinator(deletion, recording);
        const outbound = {
            requestUserDeletion: vi.fn(requestedRecordedId => parent.deleteFromRequest(requestedRecordedId)),
        };
        const child = new ServiceChildUserDeletionCoordinator(encoding, outbound);

        try {
            const operation = child.deleteByUser(recordedId);
            await vi.waitFor(() => expect(cancelled).toEqual([642]));
            expect(outbound.requestUserDeletion).not.toHaveBeenCalled();

            cancellationGates.get(642)?.resolve();
            await vi.waitFor(() => expect(cancelled).toEqual([642, 643]));
            expect(outbound.requestUserDeletion).not.toHaveBeenCalled();

            cancellationGates.get(643)?.resolve();
            await vi.waitFor(() => expect(cancelled).toEqual([642, 643, 644]));
            expect(outbound.requestUserDeletion).not.toHaveBeenCalled();

            cancellationGates.get(644)?.resolve();
            await operation;

            expect(outbound.requestUserDeletion).toHaveBeenCalledExactlyOnceWith(recordedId);
            expect(deletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(recordedId);
            expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
            expect(deletion.deletePrepared).toHaveBeenCalledOnce();
        } finally {
            encoding.listener.removeAllListeners();
            event.emitter.removeAllListeners();
        }
    });

    it('[PRIMARY WC-5.4][PRIMARY WC-5.6][PRIMARY WC-5.12][WC-5.4][WC-5.6][WC-5.12] keeps IPCServer final deletion idle until its composed recording terminal barrier settles', async () => {
        const recordedId = 651;
        const reserveId = 652;
        const token = Object.freeze(Object.create(null));
        const terminalBarrier = deferred<void>();
        const { domains, server } = makeServer();
        domains.recorded.prepareUserDeletion.mockResolvedValue({
            isRecording: true,
            reserveId,
            status: 'prepared',
            token,
        });
        domains.recording.hasReserve.mockReturnValue(true);
        domains.recording.cancelForDeletion.mockReturnValue(terminalBarrier.promise);
        const requester = makeChild();
        server.register(requester);

        requester.emit('message', { args: { recordedId }, func: 'delete', id: 651, model: 'recorded' });
        await vi.waitFor(() => expect(domains.recording.cancelForDeletion).toHaveBeenCalledExactlyOnceWith(reserveId));

        expect(domains.recorded.deletePrepared).not.toHaveBeenCalled();
        expect(requester.send).not.toHaveBeenCalled();

        terminalBarrier.resolve();
        await vi.waitFor(() => expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(token));

        expect(domains.recorded.deletePrepared.mock.calls[0][0]).toBe(token);
        expect(domains.recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            domains.recording.cancelForDeletion.mock.invocationCallOrder[0],
        );
        expect(domains.recording.cancelForDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            domains.recorded.deletePrepared.mock.invocationCallOrder[0],
        );
        await vi.waitFor(() => expect(requester.send).toHaveBeenCalledExactlyOnceWith({ id: 651, result: undefined }));
        requester.emit('close');
    });
});
