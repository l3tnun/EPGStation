import * as child_process from 'child_process';
import * as events from 'events';
import * as path from 'path';
import * as apid from '../../../../../node_modules/mirakurun/api';
import Model from '../../Model';

interface MirakurunManageModelInterface extends Model {
    addListener(callback: (tuners: apid.TunerDevice[]) => void): void;
    update(): void;
    getTuners(): apid.TunerDevice[];
}

/**
 * MirakurunManageModel
 * MirakurunUpdater を起動して DB を更新する
 */
class MirakurunManageModel extends Model implements MirakurunManageModelInterface {
    private isRunning: boolean = false;
    private tuners: apid.TunerDevice[] = [];
    private listener: events.EventEmitter = new events.EventEmitter();

    /**
     * Mirakurun 更新時に実行されるイベントに追加
     * @param callback Mirakurun 更新時に実行される
     */
    public addListener(callback: (tuners: apid.TunerDevice[]) => void): void {
        this.listener.on(MirakurunManageModel.MIRAKURUN_UPDATE_EVENT, () => {
            try {
                callback(this.tuners);
            } catch (err) {
                this.log.system.error(<any> err);
            }
        });
    }

    /**
     * mirakurun から EPG データを取得する
     * @throws MirakurunManageModelIsRunning update が他で動いているとき
     */
    public update(): void {
        if (this.isRunning) {
            throw new Error('MirakurunManageModelIsRunning');
        }

        this.isRunning = true;

        const updater = child_process.fork(path.join(__dirname, 'MirakurunUpdateExecutor.js'), [], { silent: true });
        this.log.system.info(`start Updater pid: ${ updater.pid }`);

        if (updater.stdout !== null) {
            updater.stdout.on('data', (data: string) => {
                this.log.system.info(String(data).slice(0, -1));
            });
        }

        if (updater.stderr !== null) {
            updater.stderr.on('data', (data: string) => {
                this.log.system.error(String(data).slice(0, -1));
            });
        }

        updater.once('exit', (code) => {
            if (code === 0) {
                this.log.system.info('updater done');
                this.eventsNotify();
            } else {
                this.log.system.error('MirakurunUpdater abort');
            }
            this.isRunning = false;
        });

        updater.once('disconnect', () => { this.isRunning = false; });
        updater.once('error', () => { this.isRunning = false; });

        updater.on('message', (msg) => {
            if (msg.msg === 'tuner') {
                this.tuners = msg.tuners;
                this.isRunning = false;
            }
        });
    }

    /**
     * @return tuners
     */
    public getTuners(): apid.TunerDevice[] {
        return JSON.parse(JSON.stringify(this.tuners));
    }

    /**
     * Mirakurun 更新を通知
     */
    private eventsNotify(): void {
        this.listener.emit(MirakurunManageModel.MIRAKURUN_UPDATE_EVENT);
    }
}

namespace MirakurunManageModel {
    export const MIRAKURUN_UPDATE_EVENT = 'updateMirakurun';
}

export { MirakurunManageModelInterface, MirakurunManageModel };

