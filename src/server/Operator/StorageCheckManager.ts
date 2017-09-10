import * as fs from 'fs';
import { spawn } from 'child_process';
import * as diskusage from 'diskusage';
import Base from '../Base';
import { RecordedDBInterface } from '../Model/DB/RecordedDB';
import { IPCServerInterface } from '../Model/IPC/IPCServer';
import Util from '../Util/Util';
import { RecordingManagerInterface } from './RecordingManager';

interface StorageCheckManagerInterface {
    check(threshold: number): Promise<number>;
}

/**
* ストレージの空き容量を監視する
*/
class StorageCheckManager extends Base implements StorageCheckManagerInterface {
    private static instance: StorageCheckManager;
    private static inited: boolean = false;
    private recordedDB: RecordedDBInterface;
    private ipc: IPCServerInterface;
    private recordingManager: RecordingManagerInterface;
    private intervalTime: number;
    private dir: string;
    private action: 'remove' | 'none';
    private cmd: string | null;

    public static getInstance(): StorageCheckManager {
        if(!this.inited) {
            throw new Error('StorageCheckManagerCreateInstanceError');
        }

        return this.instance;
    }

    public static init(
        recordedDB: RecordedDBInterface,
        recordingManager: RecordingManagerInterface,
        ipc: IPCServerInterface,
    ) {
        if(this.inited) { return; }
        this.instance = new StorageCheckManager(recordedDB, recordingManager, ipc);
        this.inited = true;
    }

    private constructor(
        recordedDB: RecordedDBInterface,
        recordingManager: RecordingManagerInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.ipc = ipc;
        this.recordingManager = recordingManager;
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
            if(recorded.length > 0) {
                await this.recordingManager.delete(recorded[0].id);
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

export { StorageCheckManagerInterface, StorageCheckManager };

