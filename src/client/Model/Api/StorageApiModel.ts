import * as m from 'mithril';
import * as apid from '../../../../api';
import ApiModel from './ApiModel';

interface StorageApiModelInterface extends ApiModel {
    init(): void;
    fetchStorage(): Promise<void>;
    getStorage(): apid.DiskStatus;
}

/**
 * StorageApiModel
 * /api/storage
 */
class StorageApiModel extends ApiModel implements StorageApiModelInterface {
    private diskStatus: apid.DiskStatus = { free: 0, used: 0, total: 0, };

    public init(): void {
        super.init();
        this.diskStatus = { free: 0, used: 0, total: 0, };
    }

    /**
     * ディスク情報を取得
     */
    public async fetchStorage(): Promise<void> {
        try {
            this.diskStatus = await <any> m.request({
                method: 'GET',
                url: '/api/storage',
            });
        } catch (err) {
            this.diskStatus = { free: 0, used: 0, total: 0, };
            console.error('/api/storage');
            console.error(err);
            this.openSnackbar('ストレージ情報取得に失敗しました');
        }
    }

    /**
     * diskStatus を取得
     * @return apid.DiskStatus
     */
    public getStorage(): apid.DiskStatus {
        return this.diskStatus;
    }
}

export { StorageApiModelInterface, StorageApiModel };

