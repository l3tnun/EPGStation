import { ConfigApiModelInterface } from '../Model/Api/ConfigApiModel';
import ViewModel from './ViewModel';

/**
 * MainModel
 */
export default class MainModel extends ViewModel {
    private configApiModel: ConfigApiModelInterface;

    constructor(
        configApiModel: ConfigApiModelInterface,
    ) {
        super();
        this.configApiModel = configApiModel;
    }

    public async updateConfig(): Promise<void> {
        this.configApiModel.update();
    }
}

