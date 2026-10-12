import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type StartupContinuationOutcome =
    | { readonly kind: 'Succeeded'; readonly stage: 'epg-supervisor-start' }
    | {
          readonly kind: 'Failed';
          readonly stage:
              | 'recording-reconciliation'
              | 'recording-candidates-and-start'
              | 'expired-reservation-cleanup'
              | 'epg-supervisor-start';
          readonly cause: unknown;
      };

interface StartupStages {
    runRecordingReconciliation: () => Promise<void>;
    runRecordingCandidatesAndStart: () => Promise<void>;
    runExpiredReservationCleanup: () => Promise<void>;
    startEpgSupervisor: () => Promise<void>;
}

interface Deferred {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

const StartupContinuationCoordinator = (
    require(join(snapshot, 'model/workflow/StartupContinuationCoordinator.js')) as {
        default: new () => {
            runAfterServiceSupervisionAccepted(input: StartupStages): Promise<StartupContinuationOutcome>;
        };
    }
).default;

const deferred = (): Deferred => {
    let resolve!: () => void;
    const promise = new Promise<void>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const succeeding = (): StartupStages => ({
    runRecordingReconciliation: vi.fn(async () => undefined),
    runRecordingCandidatesAndStart: vi.fn(async () => undefined),
    runExpiredReservationCleanup: vi.fn(async () => undefined),
    startEpgSupervisor: vi.fn(async () => undefined),
});

describe('startup continuation coordinator', () => {
    it('[PRIMARY WC-7.10][WC-7.10] awaits the combined recording stage, then reservation cleanup, then EPG supervisor request', async () => {
        const candidateRebuild = deferred();
        const reservationCleanup = deferred();
        const epgStart = deferred();
        const calls: string[] = [];
        const input: StartupStages = {
            runRecordingReconciliation: vi.fn(async () => {
                calls.push('reconciliation');
            }),
            runRecordingCandidatesAndStart: vi.fn(() => {
                calls.push('recording');
                return candidateRebuild.promise;
            }),
            runExpiredReservationCleanup: vi.fn(() => {
                calls.push('reservation');
                return reservationCleanup.promise;
            }),
            startEpgSupervisor: vi.fn(() => {
                calls.push('epg');
                return epgStart.promise;
            }),
        };
        const coordinator = new StartupContinuationCoordinator();

        const outcome = coordinator.runAfterServiceSupervisionAccepted(input);
        let settled = false;
        void outcome.then(() => {
            settled = true;
        });

        await vi.waitFor(() => expect(calls).toEqual(['reconciliation', 'recording']));
        expect(settled).toBe(false);
        candidateRebuild.resolve();
        await vi.waitFor(() => expect(calls).toEqual(['reconciliation', 'recording', 'reservation']));
        expect(settled).toBe(false);
        reservationCleanup.resolve();
        await vi.waitFor(() => expect(calls).toEqual(['reconciliation', 'recording', 'reservation', 'epg']));
        expect(settled).toBe(false);
        epgStart.resolve();

        await expect(outcome).resolves.toEqual({ kind: 'Succeeded', stage: 'epg-supervisor-start' });
        expect(settled).toBe(true);
        expect(input.runRecordingReconciliation).toHaveBeenCalledOnce();
        expect(input.runRecordingCandidatesAndStart).toHaveBeenCalledOnce();
        expect(input.runExpiredReservationCleanup).toHaveBeenCalledOnce();
        expect(input.startEpgSupervisor).toHaveBeenCalledOnce();
    });

    it.each([
        [
            'synchronous throw',
            (failure: Error) =>
                vi.fn(() => {
                    throw failure;
                }),
        ],
        ['rejection', (failure: Error) => vi.fn(async () => Promise.reject(failure))],
    ] as const)(
        '[WC-7.9][WC-7.10] converts a combined recording %s into a typed failure without retrying downstream stages',
        async (_, createRebuild) => {
            const failure = new Error('synthetic combined recording failure');
            const input = { ...succeeding(), runRecordingCandidatesAndStart: createRebuild(failure) };
            const coordinator = new StartupContinuationCoordinator();

            await expect(coordinator.runAfterServiceSupervisionAccepted(input)).resolves.toEqual({
                cause: failure,
                kind: 'Failed',
                stage: 'recording-candidates-and-start',
            });

            expect(input.runRecordingReconciliation).toHaveBeenCalledOnce();
            expect(input.runRecordingCandidatesAndStart).toHaveBeenCalledOnce();
            expect(input.runExpiredReservationCleanup).not.toHaveBeenCalled();
            expect(input.startEpgSupervisor).not.toHaveBeenCalled();
        },
    );

    it.each([
        [
            'synchronous throw',
            (failure: Error) =>
                vi.fn(() => {
                    throw failure;
                }),
        ],
        ['rejection', (failure: Error) => vi.fn(async () => Promise.reject(failure))],
    ] as const)(
        '[WC-7.10] converts a reservation cleanup %s into a typed failure without retrying or requesting EPG startup',
        async (_, createCleanup) => {
            const failure = new Error('synthetic reservation cleanup failure');
            const input = { ...succeeding(), runExpiredReservationCleanup: createCleanup(failure) };
            const coordinator = new StartupContinuationCoordinator();

            await expect(coordinator.runAfterServiceSupervisionAccepted(input)).resolves.toEqual({
                cause: failure,
                kind: 'Failed',
                stage: 'expired-reservation-cleanup',
            });

            expect(input.runRecordingReconciliation).toHaveBeenCalledOnce();
            expect(input.runRecordingCandidatesAndStart).toHaveBeenCalledOnce();
            expect(input.runExpiredReservationCleanup).toHaveBeenCalledOnce();
            expect(input.startEpgSupervisor).not.toHaveBeenCalled();
        },
    );

    it.each([
        [
            'synchronous throw',
            (failure: Error) =>
                vi.fn(() => {
                    throw failure;
                }),
        ],
        ['rejection', (failure: Error) => vi.fn(async () => Promise.reject(failure))],
    ] as const)(
        '[WC-7.10] converts an EPG supervisor request %s into a typed failure without retrying completed stages',
        async (_, createEpgRequest) => {
            const failure = new Error('synthetic EPG supervisor request failure');
            const input = { ...succeeding(), startEpgSupervisor: createEpgRequest(failure) };
            const coordinator = new StartupContinuationCoordinator();

            await expect(coordinator.runAfterServiceSupervisionAccepted(input)).resolves.toEqual({
                cause: failure,
                kind: 'Failed',
                stage: 'epg-supervisor-start',
            });

            expect(input.runRecordingReconciliation).toHaveBeenCalledOnce();
            expect(input.runRecordingCandidatesAndStart).toHaveBeenCalledOnce();
            expect(input.runExpiredReservationCleanup).toHaveBeenCalledOnce();
            expect(input.startEpgSupervisor).toHaveBeenCalledOnce();
        },
    );
});
