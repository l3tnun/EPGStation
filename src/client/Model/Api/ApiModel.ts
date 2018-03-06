import Model from '../Model';
import { SnackbarModelInterface } from '../Snackbar/SnackbarModel';

/**
 * ApiModel 抽象クラス
 */
abstract class ApiModel extends Model {
    private snackbar: SnackbarModelInterface;

    constructor(snackbar: SnackbarModelInterface) {
        super();

        this.snackbar = snackbar;
    }

    /**
     * 初期化
     * overwrite して使うこと
     */
    public init(): void {}

    /**
     * open snackbar
     * @param message: message
     */
    protected openSnackbar(message: string): void {
        this.snackbar.open(message);
    }
}

export default ApiModel;

