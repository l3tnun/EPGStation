import diskusage from 'diskusage-ng';
import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import IStorageApiModel from './IStorageApiModel.js';

/** `IStorageApiModel` の実装。詳細は `IStorageApiModel` を参照。 */
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
