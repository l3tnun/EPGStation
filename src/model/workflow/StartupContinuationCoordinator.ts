import RuntimeStartupWorkflowPort, {
    RuntimeStartupWorkflowInput,
    RuntimeStartupWorkflowOutcome,
} from './RuntimeStartupWorkflowPort.js';

/**
 * `RuntimeStartupWorkflowPort`の実装。DI構築時の引数は無く、`runAfterServiceSupervisionAccepted(input)`が
 * 呼び出し時に渡される`input`だけを使って4段階を順に実行する。
 */
export default class StartupContinuationCoordinator implements RuntimeStartupWorkflowPort {
    /**
     * `input`の4段階を
     * reconciliation→candidates-and-start→expired-reservation-cleanup→epg-supervisor-startの順に
     * 実行し、いずれかで例外・rejectが起きた時点でそれ以降を実行せず`Failed`を返す
     * （`Failed`はPromiseの解決値であり、rejectではない）。再試行はしない。
     * @param input 各段階の実処理。
     * @returns 全段階成功なら`Succeeded`、途中で失敗すればその段階を含む`Failed`。
     */
    public async runAfterServiceSupervisionAccepted(
        input: RuntimeStartupWorkflowInput,
    ): Promise<RuntimeStartupWorkflowOutcome> {
        try {
            await input.runRecordingReconciliation();
        } catch (cause) {
            return { cause, kind: 'Failed', stage: 'recording-reconciliation' };
        }
        try {
            await input.runRecordingCandidatesAndStart();
        } catch (cause) {
            return { cause, kind: 'Failed', stage: 'recording-candidates-and-start' };
        }
        try {
            await input.runExpiredReservationCleanup();
        } catch (cause) {
            return { cause, kind: 'Failed', stage: 'expired-reservation-cleanup' };
        }
        try {
            await input.startEpgSupervisor();
            return { kind: 'Succeeded', stage: 'epg-supervisor-start' };
        } catch (cause) {
            return { cause, kind: 'Failed', stage: 'epg-supervisor-start' };
        }
    }
}
