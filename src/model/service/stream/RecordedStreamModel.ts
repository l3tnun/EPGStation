import { injectable } from 'inversify';
import IRecordedStreamBaseModel from './base/IRecordedStreamBaseModel';
import RecordedStreamBaseModel from './base/RecordedStreamBaseModel';

@injectable()
export default class RecordedStreamModel extends RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected getStreamType(): 'RecordedStream' {
        return 'RecordedStream';
    }
}
