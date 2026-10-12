/**
 * 起動時workflowが順に実行する各段階の名前。`runAfterServiceSupervisionAccepted`はこの順
 * （reconciliation→candidates-and-start→expired-reservation-cleanup→epg-supervisor-start）で
 * 実行し、いずれかで失敗すると以降の段階は実行しない。
 */
export type RuntimeStartupWorkflowStage =
    | 'recording-reconciliation'
    | 'recording-candidates-and-start'
    | 'expired-reservation-cleanup'
    | 'epg-supervisor-start';

/**
 * `runAfterServiceSupervisionAccepted`の結果。例外を投げる代わりにこの型で返す
 * （呼び出し側はPromiseのrejectではなく戻り値の`kind`で成否を判定する）。
 * `Failed`の`stage`は、どの段階で失敗が起きたかを示す。
 */
export type RuntimeStartupWorkflowOutcome =
    | { readonly kind: 'Succeeded'; readonly stage: 'epg-supervisor-start' }
    | { readonly kind: 'Failed'; readonly stage: RuntimeStartupWorkflowStage; readonly cause: unknown };

/**
 * 起動workflowの各段階の実処理をまとめたもの。呼び出し元（`server-application-runtime`）が、
 * 各段階に600秒のoverdue監視（`observeStartupStage`）を被せた上で渡す。
 */
export interface RuntimeStartupWorkflowInput {
    readonly runRecordingReconciliation: () => Promise<void>;
    readonly runRecordingCandidatesAndStart: () => Promise<void>;
    readonly runExpiredReservationCleanup: () => Promise<void>;
    readonly startEpgSupervisor: () => Promise<void>;
}

/**
 * service監督の受付が完了した後に一度だけ呼び出される、起動時workflowの実行口。
 * 実装は`StartupContinuationCoordinator`。呼び出し自体を1回に制限する保証
 * （one-entry guard）は呼び出し元（`server-application-runtime`）の責務で、この契約自体は持たない。
 */
export default interface RuntimeStartupWorkflowPort {
    /**
     * 起動時workflowの各段階を順に実行する。
     * @param input 各段階の実処理。
     * @returns 全段階成功なら`Succeeded`、途中で失敗した段階があれば`Failed`（例外は投げない）。
     */
    runAfterServiceSupervisionAccepted(input: RuntimeStartupWorkflowInput): Promise<RuntimeStartupWorkflowOutcome>;
}
