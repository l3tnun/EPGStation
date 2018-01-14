import Model from '../Model';
import { StorageModelInterface } from '../Storage/StorageModel';

interface SizeValues {
    channelHeight: number;
    channelWidth: number;
    channelFontsize: number;
    timescaleHeight: number;
    timescaleWidth: number;
    timescaleFontsize: number;
    boardFontsize: number;
}

interface ProgramSettingValue {
    tablet: SizeValues;
    mobile: SizeValues;
}

interface ProgramSettingModelInterface extends Model {
    value: ProgramSettingValue;
    init(): void;
    get(): ProgramSettingValue | null;
    remove(): void;
    update(): void;
    getDefaultValue(): ProgramSettingValue;
    readonly isEnable: boolean;
}

/**
* ProgramSettingModel
*/
class ProgramSettingModel extends Model implements ProgramSettingModelInterface {
    private storageModel: StorageModelInterface;

    public isEnable: boolean = false;
    public value: ProgramSettingValue;

    constructor(storageModel: StorageModelInterface) {
        super();
        this.storageModel = storageModel;
    }

    /**
    * init
    */
    public init(): void {
        let stored = this.get();

        // 設定情報がない場合は作成
        if(stored === null) {
            this.value = this.getDefaultValue();
            try {
                this.storageModel.set(ProgramSettingModelInterface.storageKey, this.value);
                this.isEnable = true;
            } catch(err) {
                this.isEnable = false;
                console.error('ProgramSettingModel storage write error');
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
    public get(): ProgramSettingValue | null {
        return this.storageModel.get(ProgramSettingModelInterface.storageKey);
    }

    /**
    * 設定情報を削除
    */
    public remove(): void {
        this.storageModel.remove(ProgramSettingModelInterface.storageKey);
    }

    /**
    * 設定情報の更新
    */
    public update(): void {
        if(!this.isEnable || this.value === null) { return; }
        this.storageModel.set(ProgramSettingModelInterface.storageKey, this.value);
    }

    /**
    * set default value
    */
    public getDefaultValue(): ProgramSettingValue {
        return {
            tablet: {
                channelHeight: 30,
                channelWidth: 140,
                channelFontsize: 15,
                timescaleHeight: 180,
                timescaleWidth: 30,
                timescaleFontsize: 17,
                boardFontsize: 10,
            },
            mobile: {
                channelHeight: 20,
                channelWidth: 100,
                channelFontsize: 12,
                timescaleHeight: 120,
                timescaleWidth: 20,
                timescaleFontsize: 12,
                boardFontsize: 7.5,
            },
        };
    }
}

namespace ProgramSettingModelInterface {
    export const storageKey = 'programSetting';
}

export { ProgramSettingValue, ProgramSettingModelInterface, ProgramSettingModel };

