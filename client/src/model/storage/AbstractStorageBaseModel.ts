import { injectable } from 'inversify';
import IStorageBaseModel from './IStorageBaseModel';
import IStorageOperationModel from './IStorageOperationModel';

/**
 * IStorageBaseModel を実装する際に継承するベースクラス
 */
@injectable()
export default abstract class AbstractStorageBaseModel<T> implements IStorageBaseModel<T> {
    public tmp: T;

    private op: IStorageOperationModel;

    constructor(op: IStorageOperationModel) {
        this.op = op;
        const value = this.op.get(this.getStorageKey());

        // デフォルト値から欠けている物があれば追加 & save
        let isNeedSave = false;
        if (value !== null) {
            const defaultValue = this.getDefaultValue();
            for (const key in defaultValue) {
                if (typeof value[key] === 'undefined') {
                    value[key] = defaultValue[key];
                    isNeedSave = true;
                }
            }
        }

        if (value === null) {
            // 何も保存されていなければデフォルト値を使用
            this.tmp = this.getDefaultValue();
            this.save();
        } else {
            this.tmp = value;
        }

        if (isNeedSave === true) {
            this.save();
        }
    }

    /**
     * 保存された値を取得する
     */
    public getSavedValue(): T {
        return this.op.get(this.getStorageKey());
    }

    /**
     * tmp をリセットする
     */
    public resetTmpValue(): void {
        this.tmp = this.getSavedValue();
    }

    /**
     * tmp の内容を保存する
     */
    public save(): void {
        try {
            this.op.set(this.getStorageKey(), this.tmp);
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * デフォルト値を返す
     */
    public abstract getDefaultValue(): T;

    /**
     * 保存時に使用するキーを返す
     */
    public abstract getStorageKey(): string;
}
