import { injectable } from 'inversify';
import IRecordedStreamBaseModel from './base/IRecordedStreamBaseModel';
import RecordedStreamBaseModel from './base/RecordedStreamBaseModel';

@injectable()
export default class RecordedHLSStreamModel extends RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected getStreamType(): 'RecordedHLS' {
        return 'RecordedHLS';
    }
}
