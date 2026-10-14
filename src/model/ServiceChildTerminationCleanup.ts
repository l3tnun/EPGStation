import * as path from 'path';
import type { EncodeQueueRecord } from './operator/encode/IEncodeQueueStore.js';
import type { ServiceChildProcessEntry } from './ServiceChildProcessRegistry.js';
import type { ProcessSystem } from './ServiceChildProcessSystem.js';
import { PROCESS_STOP_CHECK_INTERVAL_MS, StopSignal, stopInStages } from './service/encode/EncodeProcessManageModel.js';

/** 終了から後始末の完了までを待つ上限（ミリ秒）。超えたら待たずに再起動へ進む。 */
export const SERVICE_CHILD_CLEANUP_CAP_MS = 30_000;

/** `ServiceChildTerminationCleanup` が使う協力者と設定。 */
export interface ServiceChildTerminationCleanupDependencies {
    /** 終了した世代の外部プロセスの記録 */
    readonly processes: { takeEntries(peer: object): Promise<readonly ServiceChildProcessEntry[]> };
    /** 録画の使用権の記録 */
    readonly recordedUse: { releasePeer(peer: object): void };
    /** エンコードの依頼の記録（出力先を読む） */
    readonly encodeQueue: { list(): Promise<EncodeQueueRecord[]> };
    /** 依頼の親保存先の名前から path を引く */
    readonly getParentDirPath: (name: string) => string | null;
    /** HLS 保存先の HLS 成果物の削除 */
    readonly hlsArtifacts: { deleteAllArtifacts(streamFilePath: string, isCancelled: () => boolean): Promise<unknown> };
    /** HLS 保存先 */
    readonly streamFilePath: string;
    /** `encodeRemoveInterruptedOutput`（省略時は有効） */
    readonly removeInterruptedOutput: boolean;
    /** OS の操作 */
    readonly system: ProcessSystem;
    /** 記録先 */
    readonly logger: { error(value: unknown): void; info(value: unknown): void };
}

interface StopOutcome {
    readonly entry: ServiceChildProcessEntry;
    readonly wasRunning: boolean;
    readonly exitConfirmed: boolean;
}

interface CleanupState {
    cancelled: boolean;
}

/**
 * 管理側（親 process）で、Web・API 側処理（子 process）が終了したときに、その世代が開始した外部プロセスを
 * 種別ごとの通常の停止と同じ方法で止め、出力途中のエンコード出力と HLS 成果物を削除し、録画の使用権を解放する。
 * 全体を `SERVICE_CHILD_CLEANUP_CAP_MS` で打ち切り、`run` は失敗しても reject しない。
 */
export default class ServiceChildTerminationCleanup {
    constructor(
        private readonly deps: ServiceChildTerminationCleanupDependencies,
        private readonly capMilliseconds: number = SERVICE_CHILD_CLEANUP_CAP_MS,
    ) {}

    /**
     * 終了した世代の後始末をする。上限を超えたら、その旨を記録して使用権を解放して戻り、それ以後は残りの
     * 後始末でファイルを削除しない。
     * @param peer 終了した Web・API 側処理
     */
    public async run(peer: object): Promise<void> {
        const state: CleanupState = { cancelled: false };
        let timer: NodeJS.Timeout | undefined;
        const cap = new Promise<'cap'>(resolve => {
            timer = setTimeout(() => resolve('cap'), this.capMilliseconds);
        });
        const outcome = await Promise.race([this.cleanUp(peer, state).then(() => 'done' as const), cap]);
        clearTimeout(timer);
        if (outcome === 'cap') {
            state.cancelled = true;
            this.deps.logger.error(
                `service child cleanup did not finish within ${this.capMilliseconds} ms; the service is restarted without waiting`,
            );
            this.deps.recordedUse.releasePeer(peer);
        }
    }

    private async cleanUp(peer: object, state: CleanupState): Promise<void> {
        const entries = await this.deps.processes.takeEntries(peer);
        const outcomes = await Promise.all(entries.map(entry => this.stop(entry)));
        if (state.cancelled) return;
        await this.deleteInterruptedOutputs(outcomes, state);
        await this.deleteHlsArtifacts(state);
        if (state.cancelled) return;
        if (outcomes.some(outcome => outcome.wasRunning && !outcome.exitConfirmed)) {
            this.deps.logger.error(
                'recorded-use leases are released although a process exit of the ended service child is not confirmed',
            );
        }
        this.deps.recordedUse.releasePeer(peer);
    }

    /**
     * 外部プロセス一件を、種別ごとの通常の停止と同じ方法で止める。エンコードと非 HLS 配信は PID へ `SIGINT` だけを
     * 送り、HLS writer は process group へ `SIGINT`、終わらなければ `SIGKILL` を送る。
     * @param entry 止める外部プロセス
     * @returns 停止を始めた時点で動いていたかと、終了を確かめられたか
     */
    private async stop(entry: ServiceChildProcessEntry): Promise<StopOutcome> {
        const signals: readonly StopSignal[] = entry.kind === 'hls' ? ['SIGINT', 'SIGKILL'] : ['SIGINT'];
        const result = await stopInStages(signals, {
            isAlive: stage => this.isSameProcessAlive(entry, stage),
            send: signal => this.send(entry, signal),
            wait: async () => {
                await this.deps.system.wait(PROCESS_STOP_CHECK_INTERVAL_MS);
                return true;
            },
            isSettled: () => false,
        });
        if (!result.exitConfirmed) {
            this.deps.logger.error({
                kind: entry.kind,
                pgid: entry.pgid,
                pid: entry.pid,
                sentSignals: result.sentSignals,
                terminalConfirmed: false,
            });
        }
        return { entry, exitConfirmed: result.exitConfirmed, wasRunning: result.wasRunning };
    }

    /**
     * 開始の知らせを受け取ったときと同じ process（HLS writer はその process group）がまだ居るかを確かめる。
     * 開始時刻が変わった PID と終了済み（zombie）の process は居ないとみなす。開始時刻を読めないときは PID だけで確かめる。
     * 確かめる操作が失敗したら記録して `undefined` を返す（居なくなったとはみなさない）。
     */
    private isSameProcessAlive(entry: ServiceChildProcessEntry, stage: string): boolean | undefined {
        try {
            if (entry.kind === 'hls') {
                const leader = this.deps.system.identify(entry.pgid!);
                if (leader.status === 'running' && entry.startTime !== null && leader.startTime !== entry.startTime) {
                    return false;
                }
                return this.deps.system.isGroupAlive(entry.pgid!);
            }
            const identity = this.deps.system.identify(entry.pid);
            switch (identity.status) {
                case 'running':
                    return entry.startTime === null || identity.startTime === entry.startTime;
                case 'unavailable':
                    return this.deps.system.isAlive(entry.pid);
                default:
                    return false;
            }
        } catch (error: unknown) {
            this.deps.logger.error({ error, kind: entry.kind, pgid: entry.pgid, pid: entry.pid, stage });
            return undefined;
        }
    }

    private send(entry: ServiceChildProcessEntry, signal: StopSignal): boolean {
        try {
            if (entry.kind === 'hls') {
                this.deps.system.signalGroup(entry.pgid!, signal);
            } else {
                this.deps.system.signal(entry.pid, signal);
            }
            return true;
        } catch (error: unknown) {
            this.deps.logger.error({
                error,
                kind: entry.kind,
                pgid: entry.pgid,
                pid: entry.pid,
                stage: `${signal}-send`,
            });
            return false;
        }
    }

    /**
     * 停止を始めた時点で動いていたエンコードの出力途中のファイルを、`encodeRemoveInterruptedOutput` が有効で、
     * 出力先が依頼の親保存先の中を指すときだけ削除する（起動時の復元と同じ規則）。
     */
    private async deleteInterruptedOutputs(outcomes: readonly StopOutcome[], state: CleanupState): Promise<void> {
        const encodeIds = outcomes
            .filter(outcome => outcome.wasRunning && outcome.entry.kind === 'encode')
            .map(outcome => outcome.entry.encodeId!);
        if (encodeIds.length === 0 || this.deps.removeInterruptedOutput === false) return;

        let records: EncodeQueueRecord[];
        try {
            records = await this.deps.encodeQueue.list();
        } catch (error: unknown) {
            this.deps.logger.error('failed to read the encode request records of the ended service child');
            this.deps.logger.error(error);
            return;
        }
        for (const encodeId of encodeIds) {
            const record = records.find(item => item.id === encodeId);
            if (state.cancelled || record === undefined || record.outputPath === null) continue;
            const outputPath = record.outputPath;
            if (this.isInsideParentDirectory(record.option.parentDir, outputPath) === false) {
                this.deps.logger.info(
                    `interrupted encode output is kept because it is outside the parent directory: ${encodeId}`,
                );
                continue;
            }
            try {
                await this.deps.system.removeFile(outputPath);
                this.deps.logger.info(
                    `deleted the interrupted encode output of the ended service child: ${outputPath}`,
                );
            } catch (error: unknown) {
                this.deps.logger.error(`failed to delete the interrupted encode output: ${outputPath}`);
                this.deps.logger.error(error);
            }
        }
    }

    private isInsideParentDirectory(parentDirName: string, outputPath: string): boolean {
        const parentDirPath = this.deps.getParentDirPath(parentDirName);
        if (parentDirPath === null) return false;
        const relative = path.relative(path.resolve(parentDirPath), path.resolve(outputPath));
        return relative !== '' && relative.startsWith('..') === false && path.isAbsolute(relative) === false;
    }

    private async deleteHlsArtifacts(state: CleanupState): Promise<void> {
        if (state.cancelled) return;
        try {
            await this.deps.hlsArtifacts.deleteAllArtifacts(this.deps.streamFilePath, () => state.cancelled);
        } catch (error: unknown) {
            this.deps.logger.error(
                `failed to delete the HLS artifacts of the ended service child: ${this.deps.streamFilePath}`,
            );
            this.deps.logger.error(error);
        }
    }
}
