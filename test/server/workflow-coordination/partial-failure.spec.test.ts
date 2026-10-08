import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const ServiceChildUserDeletionCoordinator = (
    require(join(snapshot, 'model/workflow/ServiceChildUserDeletionCoordinator.js')) as {
        default: new (
            encoding: { cancelEncodeByRecordedId(recordedId: number): Promise<void> },
            request: { requestUserDeletion(recordedId: number): Promise<void> },
        ) => { deleteByUser(recordedId: number): Promise<void> };
    }
).default;
const ParentUserDeletionCoordinator = (
    require(join(snapshot, 'model/workflow/ParentUserDeletionCoordinator.js')) as {
        default: new (
            deletion: {
                prepareUserDeletion(recordedId: number): Promise<unknown>;
                deletePrepared(token: object): Promise<void>;
            },
            recording: {
                hasReservation(reserveId: number): boolean;
                requestCancellationForDeletion(reserveId: number): Promise<void>;
            },
        ) => { deleteFromRequest(recordedId: number): Promise<void> };
    }
).default;
const ParentVideoFileDeletionCoordinator = (
    require(join(snapshot, 'model/workflow/ParentVideoFileDeletionCoordinator.js')) as {
        default: new (
            videoDeletion: {
                prepareVideoFileDeletion(videoFileId: number): Promise<unknown>;
                deletePreparedVideoFile(token: object): Promise<unknown>;
            },
            recordedDeletion: {
                prepareUserDeletion(recordedId: number): Promise<unknown>;
                deletePrepared(token: object): Promise<void>;
            },
            recording: {
                hasReservation(reserveId: number): boolean;
                requestCancellationForDeletion(reserveId: number): Promise<void>;
            },
        ) => { deleteVideoFileFromRequest(videoFileId: number): Promise<void> };
    }
).default;

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (reason?: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
    let resolve!: Deferred<T>['resolve'];
    let reject!: Deferred<T>['reject'];
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

describe('service child user deletion partial failures', () => {
    it('[WC-5.1][WC-5.2] keeps the transport-agnostic deletion request idle until Encode cancellation settles', async () => {
        const cancellation = deferred<void>();
        const encoding = { cancelEncodeByRecordedId: vi.fn(() => cancellation.promise) };
        const request = { requestUserDeletion: vi.fn(async () => undefined) };
        const coordinator = new ServiceChildUserDeletionCoordinator(encoding, request);

        const operation = coordinator.deleteByUser(612);
        expect(encoding.cancelEncodeByRecordedId).toHaveBeenCalledExactlyOnceWith(612);
        expect(request.requestUserDeletion).not.toHaveBeenCalled();

        cancellation.resolve();
        await operation;

        expect(request.requestUserDeletion).toHaveBeenCalledExactlyOnceWith(612);
    });

    it('[PRIMARY WC-7.3][WC-7.3] rejects without requesting parent deletion when the aggregated Encode cancellation rejects', async () => {
        const cancellationFailure = new Error('synthetic aggregate Encode cancellation failure');
        const encoding = { cancelEncodeByRecordedId: vi.fn(async () => Promise.reject(cancellationFailure)) };
        const request = { requestUserDeletion: vi.fn(async () => undefined) };
        const coordinator = new ServiceChildUserDeletionCoordinator(encoding, request);

        await expect(coordinator.deleteByUser(613)).rejects.toBe(cancellationFailure);

        expect(encoding.cancelEncodeByRecordedId).toHaveBeenCalledExactlyOnceWith(613);
        expect(request.requestUserDeletion).not.toHaveBeenCalled();
    });

    it('[WC-5.2][WC-5.7][WC-7.6] propagates one rejected outbound request without retrying Encode cancellation or deletion', async () => {
        const requestFailure = new Error('synthetic outbound request failure');
        const encoding = { cancelEncodeByRecordedId: vi.fn(async () => undefined) };
        const request = { requestUserDeletion: vi.fn(async () => Promise.reject(requestFailure)) };
        const coordinator = new ServiceChildUserDeletionCoordinator(encoding, request);

        await expect(coordinator.deleteByUser(614)).rejects.toBe(requestFailure);

        expect(encoding.cancelEncodeByRecordedId).toHaveBeenCalledExactlyOnceWith(614);
        expect(request.requestUserDeletion).toHaveBeenCalledExactlyOnceWith(614);
    });
});

describe('parent user deletion partial failures', () => {
    it.each([
        ['rejection', (failure: Error) => vi.fn(async () => Promise.reject(failure))],
        [
            'synchronous throw',
            (failure: Error) =>
                vi.fn(() => {
                    throw failure;
                }),
        ],
    ] as const)(
        '[PRIMARY WC-5.3][WC-5.3][WC-7.3] propagates a preparation %s without starting a terminal barrier, delete, rollback, or retry',
        async (_, makePreparation) => {
            const preparationFailure = new Error('synthetic preparation failure');
            const deletion = {
                prepareUserDeletion: makePreparation(preparationFailure),
                deletePrepared: vi.fn(async () => undefined),
                rollback: vi.fn(),
            };
            const recording = {
                hasReservation: vi.fn(() => true),
                requestCancellationForDeletion: vi.fn(async () => undefined),
                restart: vi.fn(),
            };
            const coordinator = new ParentUserDeletionCoordinator(deletion, recording);

            await expect(coordinator.deleteFromRequest(614)).rejects.toBe(preparationFailure);

            expect(deletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(614);
            expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
            expect(deletion.deletePrepared).not.toHaveBeenCalled();
            expect(deletion.rollback).not.toHaveBeenCalled();
            expect(recording.restart).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['not-found', new Error('RecordedIdIsNotFound')],
        ['protected', new Error('RecordedIsProtected')],
    ] as const)(
        '[WC-5.3][WC-5.7] rejects %s without starting a terminal barrier or final delete',
        async (status, error) => {
            const deletion = {
                prepareUserDeletion: vi.fn(async () => ({ status })),
                deletePrepared: vi.fn(async () => undefined),
            };
            const recording = {
                hasReservation: vi.fn(() => true),
                requestCancellationForDeletion: vi.fn(async () => undefined),
            };
            const coordinator = new ParentUserDeletionCoordinator(deletion, recording);

            await expect(coordinator.deleteFromRequest(615)).rejects.toMatchObject({ message: error.message });

            expect(deletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(615);
            expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
            expect(deletion.deletePrepared).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['reject', new Error('synthetic deletion terminal failure')],
        ['timeout', new Error('DeletionStopTimeoutError')],
    ] as const)(
        '[WC-5.4][WC-7.3] leaves final deletion idle when the held terminal barrier reaches %s',
        async (_, failure) => {
            const token = Object.freeze(Object.create(null));
            const terminalBarrier = deferred<void>();
            const deletion = {
                prepareUserDeletion: vi.fn(async () => ({
                    isRecording: true,
                    reserveId: 617,
                    status: 'prepared' as const,
                    token,
                })),
                deletePrepared: vi.fn(async () => undefined),
            };
            const recording = {
                hasReservation: vi.fn(() => true),
                requestCancellationForDeletion: vi.fn(() => terminalBarrier.promise),
            };
            const coordinator = new ParentUserDeletionCoordinator(deletion, recording);

            const operation = coordinator.deleteFromRequest(616);
            await vi.waitFor(() =>
                expect(recording.requestCancellationForDeletion).toHaveBeenCalledExactlyOnceWith(617),
            );
            expect(deletion.deletePrepared).not.toHaveBeenCalled();

            terminalBarrier.reject(failure);
            await expect(operation).rejects.toBe(failure);

            expect(recording.hasReservation).toHaveBeenCalledExactlyOnceWith(617);
            expect(recording.requestCancellationForDeletion).toHaveBeenCalledExactlyOnceWith(617);
            expect(deletion.deletePrepared).not.toHaveBeenCalled();
        },
    );

    it('[PRIMARY WC-5.8][PRIMARY WC-5.9][PRIMARY WC-7.1][WC-5.8][WC-5.9][WC-7.1][WC-7.6] propagates a final deletion rejection without retrying, rolling back, or restarting', async () => {
        const token = Object.freeze(Object.create(null));
        const finalDeletionFailure = new Error('synthetic prepared deletion failure');
        const deletion = {
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: true,
                reserveId: 619,
                status: 'prepared' as const,
                token,
            })),
            deletePrepared: vi.fn(async () => Promise.reject(finalDeletionFailure)),
            rollback: vi.fn(),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
            restart: vi.fn(),
        };
        const coordinator = new ParentUserDeletionCoordinator(deletion, recording);

        await expect(coordinator.deleteFromRequest(618)).rejects.toBe(finalDeletionFailure);

        expect(recording.requestCancellationForDeletion).toHaveBeenCalledExactlyOnceWith(619);
        expect(deletion.deletePrepared).toHaveBeenCalledExactlyOnceWith(token);
        expect(deletion.rollback).not.toHaveBeenCalled();
        expect(recording.restart).not.toHaveBeenCalled();
    });
});

describe('parent video file deletion partial failures', () => {
    it('[WC-5.3][WC-7.3] propagates a video preparation rejection without starting direct, whole, or recording deletion', async () => {
        const preparationFailure = new Error('synthetic video preparation failure');
        const videoDeletion = {
            prepareVideoFileDeletion: vi.fn(async () => Promise.reject(preparationFailure)),
            deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
        };
        const recordedDeletion = {
            prepareUserDeletion: vi.fn(async () => ({ status: 'prepared' as const })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

        await expect(coordinator.deleteVideoFileFromRequest(730)).rejects.toBe(preparationFailure);

        expect(videoDeletion.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(730);
        expect(videoDeletion.deletePreparedVideoFile).not.toHaveBeenCalled();
        expect(recordedDeletion.prepareUserDeletion).not.toHaveBeenCalled();
        expect(recordedDeletion.deletePrepared).not.toHaveBeenCalled();
        expect(recording.hasReservation).not.toHaveBeenCalled();
        expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
    });

    it.each([
        ['not-found', 'VideoFileIsNotFound'],
        ['protected', 'RecordedIsProtected'],
    ] as const)(
        '[WC-5.3][WC-5.7] rejects an initial individual %s result without starting direct, whole, or recording deletion',
        async (status, message) => {
            const videoDeletion = {
                prepareVideoFileDeletion: vi.fn(async () => ({ status })),
                deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
            };
            const recordedDeletion = {
                prepareUserDeletion: vi.fn(async () => ({ status: 'prepared' as const })),
                deletePrepared: vi.fn(async () => undefined),
            };
            const recording = {
                hasReservation: vi.fn(() => true),
                requestCancellationForDeletion: vi.fn(async () => undefined),
            };
            const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

            await expect(coordinator.deleteVideoFileFromRequest(731)).rejects.toMatchObject({ message });

            expect(videoDeletion.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(731);
            expect(videoDeletion.deletePreparedVideoFile).not.toHaveBeenCalled();
            expect(recordedDeletion.prepareUserDeletion).not.toHaveBeenCalled();
            expect(recordedDeletion.deletePrepared).not.toHaveBeenCalled();
            expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
        },
    );

    it('[PRIMARY WC-7.6][WC-5.7][WC-7.6] propagates a direct deletion rejection without retrying or escalating it to whole deletion', async () => {
        const videoToken = Object.freeze(Object.create(null));
        const deletionFailure = new Error('synthetic direct video deletion failure');
        const videoDeletion = {
            prepareVideoFileDeletion: vi.fn(async () => ({ status: 'prepared' as const, token: videoToken })),
            deletePreparedVideoFile: vi.fn(async () => Promise.reject(deletionFailure)),
        };
        const recordedDeletion = {
            prepareUserDeletion: vi.fn(async () => ({ status: 'prepared' as const })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

        await expect(coordinator.deleteVideoFileFromRequest(738)).rejects.toBe(deletionFailure);

        expect(videoDeletion.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(videoToken);
        expect(recordedDeletion.prepareUserDeletion).not.toHaveBeenCalled();
        expect(recordedDeletion.deletePrepared).not.toHaveBeenCalled();
        expect(recording.hasReservation).not.toHaveBeenCalled();
        expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
    });

    it.each([
        ['not-found', 'VideoFileIsNotFound'],
        ['protected', 'RecordedIsProtected'],
    ] as const)(
        '[WC-5.7] propagates a final individual %s result without escalating it to whole deletion',
        async (status, message) => {
            const videoToken = Object.freeze(Object.create(null));
            const videoDeletion = {
                prepareVideoFileDeletion: vi.fn(async () => ({ status: 'prepared' as const, token: videoToken })),
                deletePreparedVideoFile: vi.fn(async () => ({ status })),
            };
            const recordedDeletion = {
                prepareUserDeletion: vi.fn(async () => ({ status: 'prepared' as const })),
                deletePrepared: vi.fn(async () => undefined),
            };
            const recording = {
                hasReservation: vi.fn(() => true),
                requestCancellationForDeletion: vi.fn(async () => undefined),
            };
            const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

            await expect(coordinator.deleteVideoFileFromRequest(732)).rejects.toMatchObject({ message });

            expect(videoDeletion.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(videoToken);
            expect(recordedDeletion.prepareUserDeletion).not.toHaveBeenCalled();
            expect(recordedDeletion.deletePrepared).not.toHaveBeenCalled();
            expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['not-found', 'RecordedIdIsNotFound'],
        ['protected', 'RecordedIsProtected'],
    ] as const)(
        '[WC-5.4][WC-5.7] stops a whole escalation when fresh whole preparation is %s',
        async (status, message) => {
            const videoDeletion = {
                prepareVideoFileDeletion: vi.fn(async () => ({
                    recordedId: 734,
                    status: 'whole-recorded-deletion-required' as const,
                })),
                deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
            };
            const recordedDeletion = {
                prepareUserDeletion: vi.fn(async () => ({ status })),
                deletePrepared: vi.fn(async () => undefined),
            };
            const recording = {
                hasReservation: vi.fn(() => true),
                requestCancellationForDeletion: vi.fn(async () => undefined),
            };
            const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

            await expect(coordinator.deleteVideoFileFromRequest(733)).rejects.toMatchObject({ message });

            expect(videoDeletion.deletePreparedVideoFile).not.toHaveBeenCalled();
            expect(recordedDeletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(734);
            expect(recordedDeletion.deletePrepared).not.toHaveBeenCalled();
            expect(recording.hasReservation).not.toHaveBeenCalled();
            expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
        },
    );

    it('[WC-5.4][WC-7.3] leaves whole deletion idle when the fresh whole terminal barrier rejects', async () => {
        const barrierFailure = new Error('synthetic video whole terminal failure');
        const wholeToken = Object.freeze(Object.create(null));
        const videoDeletion = {
            prepareVideoFileDeletion: vi.fn(async () => ({
                recordedId: 736,
                status: 'whole-recorded-deletion-required' as const,
            })),
            deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
        };
        const recordedDeletion = {
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: true,
                reserveId: 737,
                status: 'prepared' as const,
                token: wholeToken,
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => Promise.reject(barrierFailure)),
        };
        const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

        await expect(coordinator.deleteVideoFileFromRequest(735)).rejects.toBe(barrierFailure);

        expect(recordedDeletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(736);
        expect(recording.requestCancellationForDeletion).toHaveBeenCalledExactlyOnceWith(737);
        expect(recordedDeletion.deletePrepared).not.toHaveBeenCalled();
    });
});

describe('workflow completion result shape', () => {
    it('[PRIMARY WC-7.2][WC-7.2] resolves to a bare undefined instead of a shared completion status or result list even though the escalation decision and final whole deletion are distinct typed outcomes', async () => {
        const videoDeletion = {
            prepareVideoFileDeletion: vi.fn(async () => ({
                recordedId: 742,
                status: 'whole-recorded-deletion-required' as const,
            })),
            deletePreparedVideoFile: vi.fn(async () => ({ status: 'video-file-deleted' as const })),
        };
        const wholeToken = Object.freeze(Object.create(null));
        const recordedDeletion = {
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: false,
                reserveId: null,
                status: 'prepared' as const,
                token: wholeToken,
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const coordinator = new ParentVideoFileDeletionCoordinator(videoDeletion, recordedDeletion, recording);

        await expect(coordinator.deleteVideoFileFromRequest(741)).resolves.toBeUndefined();

        expect(videoDeletion.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(741);
        expect(videoDeletion.deletePreparedVideoFile).not.toHaveBeenCalled();
        expect(recordedDeletion.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(742);
        expect(recordedDeletion.deletePrepared).toHaveBeenCalledExactlyOnceWith(wholeToken);
    });
});

describe('duplicate state-change re-acceptance', () => {
    it('[PRIMARY WC-7.4][WC-7.4] dispatches Encode cancellation and the outbound deletion request again when the same recordedId is received a second time', async () => {
        const encoding = { cancelEncodeByRecordedId: vi.fn(async () => undefined) };
        const request = { requestUserDeletion: vi.fn(async () => undefined) };
        const coordinator = new ServiceChildUserDeletionCoordinator(encoding, request);

        await coordinator.deleteByUser(650);
        await coordinator.deleteByUser(650);

        expect(encoding.cancelEncodeByRecordedId).toHaveBeenCalledTimes(2);
        expect(encoding.cancelEncodeByRecordedId).toHaveBeenNthCalledWith(1, 650);
        expect(encoding.cancelEncodeByRecordedId).toHaveBeenNthCalledWith(2, 650);
        expect(request.requestUserDeletion).toHaveBeenCalledTimes(2);
        expect(request.requestUserDeletion).toHaveBeenNthCalledWith(1, 650);
        expect(request.requestUserDeletion).toHaveBeenNthCalledWith(2, 650);
    });
});
