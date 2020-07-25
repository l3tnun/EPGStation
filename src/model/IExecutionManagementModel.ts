export type ExecutionId = string;

export default interface IExecutionManagementModel {
    getExecution(priority: number, timeout?: number): Promise<ExecutionId>;
    unLockExecution(id: ExecutionId): void;
}
