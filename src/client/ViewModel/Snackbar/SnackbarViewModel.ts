import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';

/**
 * Snackbar ViewModel
 */
class SnackbarViewModel extends ViewModel {
    private model: SnackbarModelInterface;

    constructor(model: SnackbarModelInterface) {
        super();
        this.model = model;
    }

    /**
     * snackbar を開く
     * @param message 表示するメッセージを指定する
     */
    public open(message: string): void {
        this.model.open(message);
    }

    /**
     * 表示する文字列を取得
     * 表示するものがなければ null が返される
     * @return message
     */
    public get(): string | null {
        return this.model.get();
    }
}

export default SnackbarViewModel;

