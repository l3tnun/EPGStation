import Base from '../Base';
import { ViewModelStatus } from '../Enums';

/**
* ViewModel 抽象クラス
*/
abstract class ViewModel extends Base {
    public init(_status: ViewModelStatus = 'init'): void {}
}

export default ViewModel;

