import { injectable } from 'inversify';
import IRecordedStreamBaseModel from './IRecordedStreamBaseModel';
import RecordedStreamBaseModel from './RecordedStreamBaseModel';

@injectable()
export default class RecordedHLSStreamModel extends RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected getStreamType(): 'RecordedHLS' {
        return 'RecordedHLS';
    }
}
