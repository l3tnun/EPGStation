import Base from '../Base';
import Model from './Model';

class ModelFactory extends Base {
    private static models: { [key: string]: () => Model } = {}

    private constructor() { super(); }

    /**
    * Model インスタンスの生成方法を登録する
    * @param name: Model name
    * @param callback: Model を返す
    * @throws ModelIsDuplicated すでに同じ名前で登録されている場合
    */
    public static reg(name: string, callback: () => Model): void {
        if(typeof this.models[name] !== 'undefined') {
            throw new Error('ModelIsDuplicated');
        }
        this.models[name] = callback;
    }

    /**
    * Model インスタンスを取得する
    * @param name: Model name
    * @throws ModelIsNotFound name で指定した Model instance 生成方法が存在しない場合
    * @return Model instance
    */
    public static get(name: string): Model {
        let model = this.models[name];
        if(typeof model === 'undefined') {
            throw new Error('ModelIsNotFound');
        }

        return model();
    }
}

export default ModelFactory;

