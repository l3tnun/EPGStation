import { injectable, injectFromBase } from 'inversify';
import IRecordedStreamBaseModel from './base/IRecordedStreamBaseModel.js';
import RecordedStreamBaseModel from './base/RecordedStreamBaseModel.js';

// 自前の constructor を持たない derived class は、InversifyJS 8 では base class の
// 引数の metadata を受け継がない。引数 0 と見なされ、注入されるはずの依存が undefined になる。
// base から引き継ぐことを明示する。
@injectable()
@injectFromBase({ extendConstructorArguments: true, extendProperties: true })
export default class RecordedHLSStreamModel extends RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected getStreamType(): 'RecordedHLS' {
        return 'RecordedHLS';
    }
}
