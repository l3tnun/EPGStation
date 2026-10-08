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

describe('StartupContinuationCoordinator reconciliation failure', () => {
    it('[WC-7.9][WC-7.10] returns the reconciliation failure as a typed outcome and starts no later stage', async () => {
        const failure = new Error('synthetic reconciliation failure');
        const input = {
            runRecordingReconciliation: vi.fn(async () => {
                throw failure;
            }),
            runRecordingCandidatesAndStart: vi.fn(async () => undefined),
            runExpiredReservationCleanup: vi.fn(async () => undefined),
            startEpgSupervisor: vi.fn(async () => undefined),
        };

        await expect(new StartupContinuationCoordinator().runAfterServiceSupervisionAccepted(input)).resolves.toEqual({
            cause: failure,
            kind: 'Failed',
            stage: 'recording-reconciliation',
        });

        expect(input.runRecordingReconciliation).toHaveBeenCalledOnce();
        expect(input.runRecordingCandidatesAndStart).not.toHaveBeenCalled();
        expect(input.runExpiredReservationCleanup).not.toHaveBeenCalled();
        expect(input.startEpgSupervisor).not.toHaveBeenCalled();
    });
});
