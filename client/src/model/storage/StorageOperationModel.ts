import { injectable } from 'inversify';
import IStorageOperationModel from './IStorageOperationModel';

/**
 * StorageOperationModel
 * local storage の set, get, remove を行う
 */
@injectable()
export default class StorageOperationModel implements IStorageOperationModel {
    private dummySavedValue: any | null = null;

    /**
     * 値のセット
     * @param key: string key
     * @param value: 保存する値
     */
    public set(key: string, value: any): void {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.error('local storage save error');
            this.dummySavedValue = JSON.parse(JSON.stringify(value));
        }
    }

    /**
     * key で指定した値の取得
     * @param key: string key
     * @return any | null
     */
    public get(key: string): any | null {
        let value: any | null = null;
        try {
            value = window.localStorage.getItem(key);
        } catch (err) {
            return this.dummySavedValue;
        }

        return value === null ? null : JSON.parse(value);
    }

    /**
     * key で指定した値の削除
     * @param key: string key
     */
    public remove(key: string): void {
        window.localStorage.removeItem(key);
    }
}
