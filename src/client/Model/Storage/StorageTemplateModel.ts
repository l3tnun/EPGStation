import Model from '../Model';
import { StorageModelInterface } from '../Storage/StorageModel';

/**
 * StorageTemplateModel
 */
abstract class StorageTemplateModel<T> extends Model {
    private storageModel: StorageModelInterface;

    private isEnable: boolean = false;
    private value: T;

    constructor(storageModel: StorageModelInterface) {
        super();
        this.storageModel = storageModel;

        this.init();
    }

    /**
     * init
     */
    public init(): void {
        const stored = this.get();

        // 設定情報がなければ作成する
        if (stored === null) {
            this.value = this.getDefaultValue();
            try {
                this.storageModel.set(this.getStorageKey(), this.value);
                this.isEnable = true;
            } catch (err) {
                this.isEnable = false;
                console.error('SettingModel storage write error');
                console.error(err);
            }
        } else {
            // デフォルト値と比較して足りない項目があれば追加する
            const defaultValue = this.getDefaultValue();
            let needsUpdate = false;
            for (const key in defaultValue) {
                if (typeof stored[key] === 'undefined') {
                    stored[key] = defaultValue[key];
                    needsUpdate = true;
                }
            }

            this.value = stored;
            this.isEnable = true;

            // 追加された項目があったら更新する
            if (needsUpdate) { this.update(); }
        }
    }

    /**
     * storage が有効か返す
     * @return boolean
     */
    public getStatus(): boolean {
        return this.isEnable;
    }

    /**
     * value を返す
     * @return T
     */
    public getValue(): T {
        return JSON.parse(JSON.stringify(this.value));
    }

    /**
     * set value
     * @param value: T
     */
    public setValue(value: T): void {
        this.value = value;
        this.update();
    }

    /**
     * 設定情報を取得
     */
    public get(): T | null {
        return this.storageModel.get(this.getStorageKey());
    }

    /**
     * 設定情報を削除
     */
    public remove(): void {
        this.storageModel.remove(this.getStorageKey());
    }

    /**
     * 設定情報の更新
     */
    public update(): void {
        if (!this.isEnable || this.value === null) { return; }
        this.storageModel.set(this.getStorageKey(), this.value);
    }

    /**
     * get storage key
     * @return string;
     */
    protected abstract getStorageKey(): string;

    /**
     * set default value
     */
    public abstract getDefaultValue(): T;
}

export default StorageTemplateModel;

