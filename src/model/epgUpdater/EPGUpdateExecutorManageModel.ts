import * as child_process from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import IEPGUpdateEvent from '../event/IEPGUpdateEvent.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IEPGUpdateExecutorManageModel from './IEPGUpdateExecutorManageModel.js';

/**
 * `IEPGUpdateExecutorManageModel` の実装。EPG更新を行う子process（`EPGUpdateExecutor.js`）を
 * 起動・監視し、正常終了・異常終了を問わず終了を検知するたびに（`settleTerminal`経由で）
 * 自動的に再起動し続ける常駐監視 class。子process からの `updated` message を受けて
 * `epgUpdateEvent.emitUpdated` を発行する。
 */
@injectable()
export default class EPGUpdateExecutorManageModel implements IEPGUpdateExecutorManageModel {
    private log: ILogger;
    private epgUpdateEvent: IEPGUpdateEvent;
    /** 現在監視中の子processハンドル。`execute()`が新しい子processを起動するたびに
     *  差し替わり、その子processの終了処理が確定すると`null`に戻る。 */
    private activeExecutor: child_process.ChildProcess | null = null;
    /** `activeExecutor`1回分の起動に対応する識別用object（値自体に意味は無く、参照の
     *  同一性だけを見る）。再起動のたびに新しいobjectへ差し替わることで、古い世代の
     *  listenerが新しい世代の状態を誤って確定させてしまうのを防ぐ。 */
    private activeGeneration: object | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEPGUpdateEvent') epgUpdateEvent: IEPGUpdateEvent,
    ) {
        this.log = logger.getLogger();
        this.epgUpdateEvent = epgUpdateEvent;
    }

    /**
     * EPGUpdateExecutor を実行する
     */
    public async execute(): Promise<void> {
        const executor = child_process.spawn(
            process.argv[0],
            [path.join(import.meta.dirname, 'EPGUpdateExecutor.js')],
            {
                stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            },
        );

        this.log.system.info(`start epg updater pid: ${executor.pid}`);

        const generation = {};
        let terminalSettled = false;

        // epg 更新完了
        const onMessage = (msg: unknown) => {
            if (terminalSettled || this.activeExecutor !== executor || this.activeGeneration !== generation) {
                return;
            }
            if ((<any>msg).msg === 'updated') {
                // epg 更新完了イベントを発行
                this.epgUpdateEvent.emitUpdated();
            }
        };
        const onStdout = () => {};
        const onStderr = () => {};
        const onLateError = () => {};
        const onLateClose = () => queueMicrotask(() => executor.removeListener('error', onLateError));
        const detachListeners = () => {
            executor.removeListener('message', onMessage);
            executor.removeListener('exit', onExit);
            executor.removeListener('disconnect', onDisconnect);
            executor.removeListener('close', onClose);
            executor.removeListener('error', onError);
            if (executor.stdout !== null) {
                executor.stdout.removeAllListeners();
            }
            if (executor.stderr !== null) {
                executor.stderr.removeAllListeners();
            }
        };
        const settleTerminal = (
            recordAbnormality: () => void,
            sendInterrupt = false,
            lateErrorScope: 'close' | 'same-tick' | 'none' = 'none',
        ): void => {
            if (terminalSettled || this.activeExecutor !== executor || this.activeGeneration !== generation) {
                return;
            }
            terminalSettled = true;
            recordAbnormality();
            if (sendInterrupt) {
                executor.kill('SIGINT');
            }
            detachListeners();
            if (lateErrorScope === 'close') {
                executor.on('error', onLateError);
                executor.once('close', onLateClose);
            } else if (lateErrorScope === 'same-tick') {
                executor.on('error', onLateError);
                queueMicrotask(() => executor.removeListener('error', onLateError));
            }
            this.activeExecutor = null;
            this.activeGeneration = null;
            void this.execute();
        };
        const onExit = () => settleTerminal(() => this.log.system.fatal('epg updater is abort'), false, 'close');
        const onDisconnect = () =>
            settleTerminal(() => this.log.system.fatal('epg updater is disconnected'), true, 'close');
        const onClose = () => settleTerminal(() => this.log.system.fatal('epg update is closed'), false, 'same-tick');
        const onError = (err: Error) =>
            settleTerminal(() => {
                this.log.system.fatal('epg updater is error');
                this.log.system.error(err);
            });

        executor.on('message', onMessage);
        executor.once('exit', onExit);
        executor.once('disconnect', onDisconnect);
        executor.once('close', onClose);
        executor.once('error', onError);

        // buffer が埋まらないようにする
        if (executor.stdout !== null) {
            executor.stdout.on('data', onStdout);
        }
        if (executor.stderr !== null) {
            executor.stderr.on('data', onStderr);
        }
        this.activeExecutor = executor;
        this.activeGeneration = generation;
    }
}
