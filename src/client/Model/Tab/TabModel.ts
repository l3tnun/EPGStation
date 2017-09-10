import Model from '../Model';

interface TabModelInterface extends Model {
    init(): void;
    get(): number;
    set(value: number): void;
}

class TabModel extends Model implements TabModelInterface {
    private tabIndex: number = 0;

    public init(): void {
        this.tabIndex = 0;
    }

    public get(): number {
        return this.tabIndex;
    }

    public set(value: number): void {
        this.tabIndex = value;
    }
}

export { TabModelInterface, TabModel };

