import diskusage from 'diskusage-ng';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IStorageApiModel from './IStorageApiModel';

@injectable()
export default class StorageApiModel implements IStorageApiModel {
    private config: IConfigFile;

    constructor(@inject('IConfiguration') configuration: IConfiguration) {
        this.config = configuration.getConfig();
    }

    /**
     * recorded のディスク情報を返す
     * @return Promise<apid.StorageInfo>
     */
    public async getInfo(): Promise<apid.StorageInfo> {
        const items: apid.StorageItem[] = [];

        for (const r of this.config.recorded) {
            const info = await this.getDiskInfo(r.path);
            (info as apid.StorageItem).name = r.name;
            items.push(info as apid.StorageItem);
        }

        return {
            items: items,
        };
    }

    /**
     * 指定したディレクトリのディスク使用情報を取得する
     * @param dirPath ディスクディレクトリ
     */
    private getDiskInfo(dirPath: string): Promise<apid.DiskUsage> {
        return new Promise<apid.DiskUsage>((resolve, reject) => {
            diskusage(dirPath, (err, usage) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        available: usage.available,
                        used: usage.used,
                        total: usage.total,
                    });
                }
            });
        });
    }
}
