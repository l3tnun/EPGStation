import { TabModelInterface } from '../../Model/Tab/TabModel';
import ViewModel from '../ViewModel';

class TabViewModel extends ViewModel {
    private model: TabModelInterface;

    constructor(model: TabModelInterface) {
        super();
        this.model = model;
    }

    /**
     * init
     */
    public init(): void {
        this.model.init();
    }

    public get(): number {
        return this.model.get();
    }

    public set(value: number): void {
        return this.model.set(value);
    }
}

export default TabViewModel;

