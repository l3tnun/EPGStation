import { inject, injectable } from 'inversify';
import Util from '../../../util/Util';
import IStorageApiModel from '../../api/storage/IStorageApiModel';
import IStorageState, { StorageInfo } from './IStorageState';

@injectable()
export default class StorageState implements IStorageState {
    private storageApiModel: IStorageApiModel;

    private infos: StorageInfo[] = [];

    constructor(@inject('IStorageApiModel') storageApiModel: IStorageApiModel) {
        this.storageApiModel = storageApiModel;
    }

    /**
     * 取得したストレージ情報をクリア
     */
    public clearData(): void {
        this.infos = [];
    }

    /**
     * ストレージ情報の取得
     */
    public async fetchData(): Promise<void> {
        const storages = await this.storageApiModel.getInfo();

        storages.items.push(JSON.parse(JSON.stringify(storages.items[0])));
        storages.items[1].name = 'recorded2';
        storages.items[1].used = storages.items[1].used / 2;
        storages.items[1].available = storages.items[1].available * 2;

        this.infos = storages.items.map(s => {
            return {
                name: s.name,
                available: Util.getFileSizeStr(s.available),
                used: Util.getFileSizeStr(s.used),
                total: Util.getFileSizeStr(s.total),
                useRate: Math.floor((s.used / s.total) * 100),
            };
        });
    }

    /**
     * 取得したストレージ情報を返す
     * @return StorageInfo[]
     */
    public getInfos(): StorageInfo[] {
        return this.infos;
    }
}
