import { spawn } from 'child_process';
import * as diskusage from 'diskusage';
import ProcessUtil from '../../../Util/ProcessUtil';
import Util from '../../../Util/Util';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { IPCServerInterface } from '../../IPC/IPCServer';
import Model from '../../Model';
import { RecordedManageModelInterface } from '../Recorded/RecordedManageModel';

interface StorageCheckManageModelInterface extends Model {
    check(threshold: number): Promise<number>;
}

/**
 * ストレージの空き容量を監視する
 */
class StorageCheckManageModel extends Model implements StorageCheckManageModelInterface {
    private recordedDB: RecordedDBInterface;
    private ipc: IPCServerInterface;
    private recordedManage: RecordedManageModelInterface;
    private intervalTime: number;
    private dir: string;
    private action: 'remove' | 'none';
    private cmd: string | null;

    constructor(
        recordedDB: RecordedDBInterface,
        recordedManage: RecordedManageModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.ipc = ipc;
        this.recordedManage = recordedManage;
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
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result.available / 1024 / 1024);
                    }
                });
            });
        } catch (err) {
            this.log.system.error('StorageCheckError');
            this.log.system.error(err);

            return this.intervalTime;
        }

        if (free > threshold) { return this.intervalTime; }
        this.log.system.info(`free: ${ free }, threshold: ${ threshold }`);

        let intervalTime = this.intervalTime;

        if (this.action === 'remove') {
            // 削除
            const recorded = await this.recordedDB.findOld();
            if (recorded !== null) {
                await this.recordedManage.delete(recorded.id);
                this.ipc.notifIo();
                intervalTime = 1000;
            }
        }

        if (this.cmd !== null) {
            // cmd の実行
            try {
                this.log.system.info(`run: ${ this.cmd }`);
                const cmds = ProcessUtil.parseCmdStr(this.cmd);
                spawn(cmds.bin, cmds.args);
            } catch (err) {
                this.log.system.error(<any> err);

                return intervalTime;
            }
        }

        return intervalTime;
    }
}

export { StorageCheckManageModelInterface, StorageCheckManageModel };

