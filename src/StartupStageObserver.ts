/** 起動workflowの1段階が「時間がかかりすぎている」とみなすまでの猶予（10分）。 */
export const STARTUP_STAGE_OVERDUE_MS = 600_000;

/**
 * 起動workflowの1段階（`operation`）を実行しつつ、`STARTUP_STAGE_OVERDUE_MS`以内に完了しなければ
 * `recordOverdue`を呼んで超過を記録する監視用wrapper。`operation`自体を中断・キャンセルはせず、
 * 完了を待ち続ける（`recordOverdue`はログ記録等の副作用のみを想定）。
 * @param operation 監視対象の非同期処理。
 * @param recordOverdue `STARTUP_STAGE_OVERDUE_MS`経過してもまだ完了していない場合に1回呼ばれるcallback。
 * @returns `operation`の結果。
 */
const observeStartupStage = async <T>(operation: () => Promise<T>, recordOverdue: () => void): Promise<T> => {
    const overdueTimer = setTimeout(recordOverdue, STARTUP_STAGE_OVERDUE_MS);
    try {
        return await operation();
    } finally {
        clearTimeout(overdueTimer);
    }
};

export default observeStartupStage;
