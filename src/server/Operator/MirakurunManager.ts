import * as child_process from 'child_process';
import * as path from 'path';
import * as events from 'events';
import * as apid from '../../../node_modules/mirakurun/api';

import Base from '../Base';

interface MirakurunManagerInterface {
    update(): void;
    getTuners(): apid.TunerDevice[];
}

/**
* MirakurunManager
* MirakurunUpdater を起動して DB を更新する
*/
class MirakurunManager extends Base implements MirakurunManagerInterface {
    private static instance: MirakurunManager;
    private isRunning: boolean = false;
    private tuners: apid.TunerDevice[] = [];
    private listener: events.EventEmitter = new events.EventEmitter();

    public static getInstance(): MirakurunManager {
        if(!this.instance) {
            this.instance = new MirakurunManager();
        }

        return this.instance;
    }

    /**
    * Mirakurun 更新時に実行されるイベントに追加
    @param callback Mirakurun 更新時に実行される
    */
    public addListener(callback: (tuners: apid.TunerDevice[]) => void): void {
        this.listener.on(MirakurunManager.MIRAKURUN_UPDATE_EVENT, () => {
            callback(this.tuners);
        });
    }

    /**
    * mirakurun から EPG データを取得する
    * @throws MirakurunManagerIsRunning update が他で動いているとき
    */
    public update(): void {
        if(this.isRunning) {
            throw new Error('MirakurunManagerIsRunning');
        }

        this.isRunning = true;

        let updater = child_process.fork(path.join(__dirname, 'MirakurunUpdater.js'), [], { silent: true });
        this.log.system.info(`start Updater pid: ${ updater.pid }`);

        updater.stdout.on('data', (data: string) => {
            this.log.system.info(String(data).slice(0, -1));
        });

        updater.stderr.on('data', (data: string) => {
            this.log.system.error(String(data).slice(0, -1));
        });

        updater.once('exit', (code) => { if(code !== 0) { this.log.system.error('MirakurunUpdater abort'); } this.isRunning = false; });
        updater.once('disconnect', () => { this.isRunning = false; });
        updater.once('error', () => { this.isRunning = false; });

        updater.on('message', (msg) => {
            if(msg.msg === 'tuner') {
                this.tuners = msg.tuners;
                this.isRunning = false;
                this.eventsNotify();
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
        this.listener.emit(MirakurunManager.MIRAKURUN_UPDATE_EVENT);
    }
}

namespace MirakurunManager {
    export const MIRAKURUN_UPDATE_EVENT = "updateMirakurun";
}

export { MirakurunManagerInterface, MirakurunManager };

