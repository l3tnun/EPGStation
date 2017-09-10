import ApiModel from './ApiModel';
import Util from '../../Util/Util';
import * as diskusage from 'diskusage';
import { DiskStatus } from '../../../../api';

interface StorageModelInterface extends ApiModel {
    getStatus(): Promise<DiskStatus>;
}

class StorageModel extends ApiModel implements StorageModelInterface {
    public getStatus(): Promise<DiskStatus> {
        let dir = Util.getRecordedPath();
        return new Promise<DiskStatus>((resolve: (usage: DiskStatus) => void, reject: (err: Error) => void) => {
            diskusage.check(dir, (err, result) => {
                if(err) {
                    reject(err);
                } else {
                    resolve({
                        free: result.available,
                        used: result.total - result.available,
                        total: result.total,
                    });
                }
            });
        });
    }
}

export { StorageModelInterface, StorageModel };

