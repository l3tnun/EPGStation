/**
 * `getExecution` が発行する実行権（lock）を識別する id。`unLockExecution` に渡して
 * 対応する実行権を解放する。
 */
export type ExecutionId = number;

/**
 * 優先度付き・排他的な実行権（lock）を管理する契約。同時に 1 つの利用者だけが
 * 実行権を保持できるようにし、待機中の要求は優先度が高い順に許可される
 * （tuner の排他制御など、同時実行できない処理の直列化に使う）。実装は `ExecutionManagementModel`。
 */
export default interface IExecutionManagementModel {
    /**
     * 実行権を要求する。既に他の利用者が保持している場合は、解放されるか自分の順番が
     * 来るまで待機する。
     * @param priority 優先度。値が大きいほど先に許可される
     * @param timeout 許可されるまで待機する上限時間（ミリ秒）。省略時は実装既定値
     * @returns 許可された実行権の id。待機中に `timeout` を超えた場合は reject される
     */
    getExecution(priority: number, timeout?: number): Promise<ExecutionId>;
    /**
     * 保持している実行権を解放する。解放後、待機中の要求があれば次の実行権が許可される。
     * @param id `getExecution` で取得した実行権の id
     */
    unLockExecution(id: ExecutionId): void;
}
