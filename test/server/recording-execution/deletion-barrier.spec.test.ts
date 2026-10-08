import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeManager, makeRecorder, makeReserve } from './_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const RecordingManageModel = load<{ prototype: Record<string, unknown> }>(
    'model/operator/recording/RecordingManageModel.js',
);
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
    ) => {
        deleteFromRequest(recordedId: number): Promise<void>;
    }
>('model/workflow/ParentUserDeletionCoordinator.js');

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

afterEach(() => vi.useRealTimers());

describe('recording deletion terminal port', () => {
    it('[Task 2.5] does not settle a deletion request until its recorded terminal barrier settles', async () => {
        const reserveId = 701;
        const request = deferred<void>();
        const terminal = deferred<void>();
        const target: any = Object.create(RecordingManageModel.prototype);
        target.cancel = vi.fn(() => request.promise);
        target.deletionStops = new Map([
            [reserveId, { recorder: {}, request: request.promise, terminal: terminal.promise }],
        ]);

        let settled = false;
        const operation = target.cancelForDeletion(reserveId).then(() => {
            settled = true;
        });

        expect(target.cancel).toHaveBeenCalledWith(reserveId, true);
        request.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        terminal.resolve();
        await operation;
        expect(settled).toBe(true);
    });

    it('[Task 2.5] settles through the cancellation request when no deletion terminal exists', async () => {
        const reserveId = 702;
        const request = deferred<void>();
        const target: any = Object.create(RecordingManageModel.prototype);
        target.cancel = vi.fn(() => request.promise);
        target.deletionStops = new Map();

        const operation = target.cancelForDeletion(reserveId);

        expect(target.cancel).toHaveBeenCalledWith(reserveId, true);
        request.resolve();
        await expect(operation).resolves.toBeUndefined();
    });

    // The 59_999/60_000 boundary below is RecorderModel.DELETION_STOP_TIMEOUT_MS
    // (src/model/operator/recording/RecorderModel.ts:34), a v3-only stop-for-deletion deadline
    // with no v2 counterpart -- approved in
    // .kiro/specs/server-recording-execution/design.md:653.
    it('[Task 2.5] propagates the bounded deletion timeout without finalizing after the late terminal', async () => {
        vi.useFakeTimers();
        const reserve = makeReserve({ id: 703, startAt: Date.now() + 3_600_000, endAt: Date.now() + 3_660_000 });
        const recorder = makeRecorder();
        const manager = makeManager({ provider: vi.fn(async () => recorder.model) });
        await manager.model.update({ insert: [reserve], isSuppressLog: false });

        const writer = new EventEmitter() as EventEmitter & { closed: boolean; end: ReturnType<typeof vi.fn> };
        writer.closed = false;
        writer.end = vi.fn();
        recorder.model.stream = new PassThrough();
        recorder.model.recFile = writer;
        recorder.model.isRecording = true;

        const token = Object.freeze(Object.create(null));
        const deletion = {
            prepareUserDeletion: vi.fn(async () => ({
                status: 'prepared',
                token,
                isRecording: true,
                reserveId: reserve.id,
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const coordinator = new ParentUserDeletionCoordinator(deletion, {
            hasReservation: reserveId => manager.model.hasReserve(reserveId),
            requestCancellationForDeletion: reserveId => manager.model.cancelForDeletion(reserveId),
        });
        const unhandledRejections: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandledRejections.push(reason);
        process.prependListener('unhandledRejection', recordUnhandled);

        let settlement: unknown;
        const operation = coordinator.deleteFromRequest(704).then(
            () => {
                settlement = 'resolved';
            },
            error => {
                settlement = error;
            },
        );

        try {
            await vi.advanceTimersByTimeAsync(59_999);
            expect(settlement).toBeUndefined();
            expect(deletion.deletePrepared).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            expect(settlement).toMatchObject({ message: 'DeletionStopTimeoutError' });
            expect(deletion.deletePrepared).not.toHaveBeenCalled();

            writer.closed = true;
            writer.emit('close');
            await recorder.model.whenDeletionTerminal();
            await operation;
            await Promise.resolve();

            expect(deletion.deletePrepared).not.toHaveBeenCalled();
            expect(unhandledRejections).toEqual([]);
        } finally {
            if (!writer.closed) {
                writer.closed = true;
                writer.emit('close');
            }
            await recorder.model.whenDeletionTerminal().catch(() => undefined);
            await operation;
            manager.model.scheduleController.stop();
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });
});
