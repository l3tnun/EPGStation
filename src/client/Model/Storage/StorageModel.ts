import Model from '../Model';

interface StorageModelInterface extends Model {
    set(key: string, value: any): void;
    get(key: string): any | null;
    remove(key: string): void;
}

/**
* local storage の set get remove を行う
*/
class StorageModel extends Model implements StorageModelInterface {
    /**
    * 値のセット
    * @param key key
    * @param value JSON.stringify で変換して保存される
    */
    public set(key: string, value: any): void {
        window.localStorage.setItem(key, JSON.stringify(value));
    }

    /**
    * key で指定した値の取得
    * @param key key
    */
    public get(key: string): any | null {
        let value: any | null
        try {
            value = window.localStorage.getItem(key);
        } catch(e) {
            return null;
        }

        return value == null ? null : JSON.parse(value);
    }

    /**
    * key で指定した値の削除
    * @param key key
    */

    public remove(key: string): void {
        window.localStorage.removeItem(key);
    }
}

export { StorageModelInterface, StorageModel };

