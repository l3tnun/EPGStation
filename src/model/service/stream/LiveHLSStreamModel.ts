import { injectable } from 'inversify';
import ILiveStreamBaseModel from './base/ILiveStreamBaseModel';
import LiveStreamBaseModel from './base/LiveStreamBaseModel';

@injectable()
export default class LiveHLSStreamModel extends LiveStreamBaseModel implements ILiveStreamBaseModel {
    protected getStreamType(): 'LiveHLS' {
        return 'LiveHLS';
    }
}
