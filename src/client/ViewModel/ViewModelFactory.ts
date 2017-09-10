import Base from '../Base';
import ViewModel from './ViewModel';

/**
* ViewModelFactory
* ViewModel のインスタンスを管理する
*/

class ViewModelFactory extends Base {
    private static models: { [key: string]: ViewModel } = {};

    private constructor() { super(); }

    /**
    * ViewModel インスタンスの登録
    * @param name: ViewModel name
    * @param instance: ViewModel instance
    * @throws ViewModelIsDuplicated すでに同じ名前で登録されている場合
    */
    public static reg(name: string, instance: ViewModel): void {
        if(typeof this.models[name] !== 'undefined') {
            console.error(`${ name } is duplicated`);
            throw new Error('ViewModelIsDuplicated');
        }
        this.models[name] = instance;
    }

    /**
    * ViewModel インスタンスを取得する
    * @param name: ViewModel name
    * @throws ViewModelIsNotFound name で指定した ViewModel が存在しない
    * @return ViewModel instance
    */
    public static get(name: string): ViewModel {
        if(typeof this.models[name] === 'undefined') {
            console.error(`${ name } is not found`);
            throw new Error('ViewModelIsNotFound');
        }
        return this.models[name];
    }
}

export default ViewModelFactory;

