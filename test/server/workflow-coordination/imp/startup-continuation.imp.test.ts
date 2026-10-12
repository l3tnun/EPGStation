import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const StartupContinuationCoordinator = (
    require(join(snapshot, 'model/workflow/StartupContinuationCoordinator.js')) as {
        default: new () => {
            runAfterServiceSupervisionAccepted(input: Record<string, () => Promise<void>>): Promise<unknown>;
        };
    }
).default;

describe('StartupContinuationCoordinator characteristics', () => {
    it('[WC-7.10] does not retain a failed continuation outcome or retry within either invocation', async () => {
        const firstFailure = new Error('synthetic first combined recording failure');
        const input = {
            runRecordingReconciliation: vi.fn(async () => undefined),
            runRecordingCandidatesAndStart: vi
                .fn<() => Promise<void>>()
                .mockRejectedValueOnce(firstFailure)
                .mockResolvedValueOnce(undefined),
            runExpiredReservationCleanup: vi.fn(async () => undefined),
            startEpgSupervisor: vi.fn(async () => undefined),
        };
        const coordinator = new StartupContinuationCoordinator();

        await expect(coordinator.runAfterServiceSupervisionAccepted(input)).resolves.toEqual({
            cause: firstFailure,
            kind: 'Failed',
            stage: 'recording-candidates-and-start',
        });
        await expect(coordinator.runAfterServiceSupervisionAccepted(input)).resolves.toEqual({
            kind: 'Succeeded',
            stage: 'epg-supervisor-start',
        });

        expect(input.runRecordingReconciliation).toHaveBeenCalledTimes(2);
        expect(input.runRecordingCandidatesAndStart).toHaveBeenCalledTimes(2);
        expect(input.runExpiredReservationCleanup).toHaveBeenCalledOnce();
        expect(input.startEpgSupervisor).toHaveBeenCalledOnce();
    });
});
