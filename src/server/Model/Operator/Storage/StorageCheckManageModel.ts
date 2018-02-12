import * as fs from 'fs';
import { spawn } from 'child_process';
import * as diskusage from 'diskusage';
import Model from '../../Model';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { IPCServerInterface } from '../../IPC/IPCServer';
import Util from '../../../Util/Util';
import { RecordingManageModelInterface } from '../Recording/RecordingManageModel';

interface StorageCheckManageModelInterface extends Model {
    check(threshold: number): Promise<number>;
}

/**
* ストレージの空き容量を監視する
*/
class StorageCheckManageModel extends Model implements StorageCheckManageModelInterface {
    private recordedDB: RecordedDBInterface;
    private ipc: IPCServerInterface;
    private recordingManage: RecordingManageModelInterface;
    private intervalTime: number;
    private dir: string;
    private action: 'remove' | 'none';
    private cmd: string | null;

    constructor(
        recordedDB: RecordedDBInterface,
        recordingManage: RecordingManageModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.ipc = ipc;
        this.recordingManage = recordingManage;
        const config = this.config.getConfig();
        this.intervalTime = (config.storageLimitCheckIntervalTime | 60) * 1000;
        this.dir = Util.getRecordedPath();
        this.action = config.storageLimitAction || 'none';
        this.cmd = config.storageLimitCmd || null;       
    }

    /**
    * check
    * @return Promise<number> 次の待ち時間を返す(ms)
    */
    public async check(threshold: number): Promise<number> {
        let free: number;

        try {
            // 空き容量を取得
            free = await new Promise<number>((resolve: (free: number) => void, reject: (err: Error) => void) => {
                diskusage.check(this.dir, (err, result) => {
                    if(err) {
                        reject(err);
                    } else {
                        resolve(result.available / 1024 / 1024);
                    }
                });
            });
        } catch(err) {
            this.log.system.error('StorageCheckError');
            this.log.system.error(err);
            return this.intervalTime;
        }

        if(free > threshold) { return this.intervalTime; }
        this.log.system.info(`free: ${ free }, threshold: ${ threshold }`);

        let intervalTime = this.intervalTime;

        if(this.action === 'remove') {
            // 削除
            let recorded = await this.recordedDB.findOld();
            if(recorded !== null) {
                await this.recordingManage.deleteAll(recorded.id);
                this.ipc.notifIo();
                intervalTime = 1000;
            }
        }

        if(this.cmd !== null) {
            let args = this.cmd.split(' ');
            const bin = args.shift();

            // cmd の実行
            try {
                // cmd の存在確認
                if(typeof bin === 'undefined') { throw new Error('storageLimitCmdIsUndefined'); }
                fs.statSync(bin);
            } catch(err) {
                this.log.system.error(`${ bin } is not found.`);
                return intervalTime;
            }

            spawn(bin, args);
            this.log.system.info(`run: ${ this.cmd }`);
        }

        return intervalTime;
    }
}

export { StorageCheckManageModelInterface, StorageCheckManageModel };

