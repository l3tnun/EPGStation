import * as diskusage from 'diskusage';
import { DiskStatus } from '../../../../api';
import Util from '../../Util/Util';
import ApiModel from './ApiModel';

interface StorageModelInterface extends ApiModel {
    getStatus(): Promise<DiskStatus>;
}

class StorageModel extends ApiModel implements StorageModelInterface {
    public getStatus(): Promise<DiskStatus> {
        const dir = Util.getRecordedPath();

        return new Promise<DiskStatus>((resolve: (usage: DiskStatus) => void, reject: (err: Error) => void) => {
            diskusage.check(dir, (err, result) => {
                if (err) {
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

