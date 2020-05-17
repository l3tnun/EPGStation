import * as child_process from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import IEPGUpdateEvent from '../event/IEPGUpdateEvent';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEPGUpdateExecutorManageModel from './IEPGUpdateExecutorManageModel';

@injectable()
export default class EPGUpdateExecutorManageModel implements IEPGUpdateExecutorManageModel {
    private log: ILogger;
    private epgUpdateEvent: IEPGUpdateEvent;
    private isRestarting: boolean = false;

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
        const executor = child_process.spawn(process.argv[0], [path.join(__dirname, 'EPGUpdateExecutor.js')], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });

        this.log.system.info(`start epg updater pid: ${executor.pid}`);

        // epg 更新完了
        executor.on('message', msg => {
            if ((<any>msg).msg === 'updated') {
                // epg 更新完了イベントを発行
                this.epgUpdateEvent.emitUpdated();
            }
        });
        /**
         * エラー処理
         */
        executor.once('exit', () => {
            this.log.system.fatal('epg updater is abort');

            this.restart(executor);
        });
        executor.once('disconnect', () => {
            this.log.system.fatal('epg updater is disconnected');

            executor.kill('SIGINT');
            this.restart(executor);
        });
        executor.once('close', () => {
            this.log.system.fatal('epg update is closed');

            this.restart(executor);
        });
        executor.once('error', err => {
            this.log.system.fatal('epg updater is error');
            this.log.system.error(err);

            this.restart(executor);
        });

        // buffer が埋まらないようにする
        if (executor.stdout !== null) {
            executor.stdout.on('data', () => {});
        }
        if (executor.stderr !== null) {
            executor.stderr.on('data', () => {});
        }

        // TODO ping pong
    }

    /**
     * executor 再スタート
     * @param executor child_process.ChildProcess
     */
    private restart(executor: child_process.ChildProcess): void {
        if (this.isRestarting === true) {
            return;
        }

        this.isRestarting = true;
        executor.removeAllListeners();
        if (executor.stdout !== null) {
            executor.stdout.removeAllListeners();
        }
        if (executor.stderr !== null) {
            executor.stderr.removeAllListeners();
        }

        // restart
        this.isRestarting = false;
        this.execute();
    }
}
