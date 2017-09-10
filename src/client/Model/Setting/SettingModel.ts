import Model from '../Model';
import { StorageModelInterface } from '../Storage/StorageModel';

interface SettingValue {
    programFixScroll: boolean;
    programLength: number;
    recordedLength: number;
    reservesLength: number;
    ruleLength: number;
}

interface SettingModelInterface extends Model {
    value: SettingValue;
    init(): void;
    get(): SettingValue | null;
    remove(): void;
    update(): void;
    getDefaultValue(): SettingValue;
    readonly isEnable: boolean;
}

/**
* Setting Model
*/
class SettingModel extends Model implements SettingModelInterface {
    private storageModel: StorageModelInterface;

    public isEnable: boolean = false;
    public value: SettingValue;

    constructor(storageModel: StorageModelInterface) {
        super();
        this.storageModel = storageModel;
    }

    /**
    * init
    */
    public init(): void {
        let stored = this.get();

        // 設定情報がなければ作成する
        if(stored === null) {
            this.value = this.getDefaultValue();
            try {
                this.storageModel.set(SettingModelInterface.storageKey, this.value);
                this.isEnable = true;
            } catch(err) {
                this.isEnable = false;
                console.error('SettingModel storage write error');
                console.error(err);
            }
        } else {
            this.value = stored;
            this.isEnable = true;
        }
    }

    /**
    * 設定情報を取得
    */
    public get(): SettingValue | null {
        return this.storageModel.get(SettingModelInterface.storageKey);
    }

    /**
    * 設定情報を削除
    */
    public remove(): void {
        this.storageModel.remove(SettingModelInterface.storageKey);
    }

    /**
    * 設定情報の更新
    */
    public update(): void {
        if(!this.isEnable || this.value === null) { return; }
        this.storageModel.set(SettingModelInterface.storageKey, this.value);
    }

    /**
    * set default value
    */
    public getDefaultValue(): SettingValue {
        return {
            programFixScroll: false,
            programLength: 24,
            recordedLength: 24,
            reservesLength: 24,
            ruleLength: 24,
        };
    }
}

namespace SettingModelInterface {
    export const storageKey = 'setting';
}

export { SettingValue, SettingModelInterface, SettingModel };

