import { injectable } from 'inversify';
import ILiveStreamBaseModel from './base/ILiveStreamBaseModel';
import LiveStreamBaseModel from './base/LiveStreamBaseModel';

@injectable()
export default class LiveStreamModel extends LiveStreamBaseModel implements ILiveStreamBaseModel {
    protected getStreamType(): 'LiveStream' {
        return 'LiveStream';
    }
}
