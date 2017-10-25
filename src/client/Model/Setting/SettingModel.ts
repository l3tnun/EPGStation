import Model from '../Model';
import { StorageModelInterface } from '../Storage/StorageModel';
import Util from '../../Util/Util';

interface SettingValue {
    programFixScroll: boolean;
    programLength: number;
    recordedLength: number;
    reservesLength: number;
    ruleLength: number;
    isEnableMegTsStreamingURLScheme: boolean;
    customMegTsStreamingURLScheme: string | null;
    isEnableRecordedViewerURLScheme: boolean;
    customRecordedViewerURLScheme: string | null;
    isEnableEecordedDownloaderURLScheme: boolean;
    customEecordedDownloaderURLScheme: string | null;
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
            //デフォルト値と比較して足りない項目があれば追加する
            const defaultValue = this.getDefaultValue();
            let needsUpdate = false;
            for(let key in defaultValue) {
                if(typeof stored[key] === 'undefined') {
                    stored[key] = defaultValue[key];
                    needsUpdate = true;
                }
            }

            this.value = stored;
            this.isEnable = true;

            //追加された項目があったら更新する
            if(needsUpdate) { this.update(); }
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
        const hasURLSchemeConfigUA = Util.uaIsiOS() || Util.uaIsAndroid();

        return {
            programFixScroll: false,
            programLength: 24,
            recordedLength: 24,
            reservesLength: 24,
            ruleLength: 24,
            isEnableMegTsStreamingURLScheme: hasURLSchemeConfigUA,
            customMegTsStreamingURLScheme: null,
            isEnableRecordedViewerURLScheme: hasURLSchemeConfigUA,
            customRecordedViewerURLScheme: null,
            isEnableEecordedDownloaderURLScheme: hasURLSchemeConfigUA,
            customEecordedDownloaderURLScheme: null,
        };
    }
}

namespace SettingModelInterface {
    export const storageKey = 'setting';
}

export { SettingValue, SettingModelInterface, SettingModel };

