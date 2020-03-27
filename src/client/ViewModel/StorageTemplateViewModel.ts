import { SnackbarModelInterface } from '../Model/Snackbar/SnackbarModel';
import StorageTemplateModel from '../Model/Storage/StorageTemplateModel';
import ViewModel from './ViewModel';

/**
 * StorageTemplateViewModel
 */
abstract class StorageTemplateViewModel<T> extends ViewModel {
    private storageModel: StorageTemplateModel<T>;
    private snackbar: SnackbarModelInterface;

    public tmpValue: T;

    constructor(
        storageModel: StorageTemplateModel<T>,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.storageModel = storageModel;
        this.snackbar = snackbar;

        this.storageModel.init();
        this.resetTmp();
    }

    /**
     * 一時領域のセット
     */
    public resetTmp(): void {
        this.tmpValue = this.storageModel.getValue();
    }

    /**
     * isEnable
     * @return boolean
     */
    public isEnable(): boolean {
        return this.storageModel.getStatus();
    }

    /**
     * 一時保存領域のセット
     */
    public reset(): void {
        this.tmpValue = this.storageModel.getDefaultValue();
    }

    /**
     * save
     */
    public save(): void {
        this.storageModel.setValue(this.tmpValue);
        const message = this.getSaveMessage();
        if (message !== null) {
            this.snackbar.open(message);
        }
    }

    /**
     * get value
     * @return T
     */
    public getValue(): T {
        return this.storageModel.getValue();
    }

    /**
     * get save message
     * @return string
     */
    protected abstract getSaveMessage(): string | null;
}

export default StorageTemplateViewModel;

