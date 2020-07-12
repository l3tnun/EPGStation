import * as apid from '../../../../../api';
import IStreamBaseModel from './IStreamBaseModel';

export type LiveStreamModelProvider = () => Promise<ILiveStreamBaseModel>;
export type LiveHLSStreamModelProvider = () => Promise<ILiveStreamBaseModel>;

export interface LiveStreamOption {
    channelId: apid.ChannelId;
    cmd?: string;
}

export default interface ILiveStreamBaseModel extends IStreamBaseModel<LiveStreamOption> {
    setOption(option: LiveStreamOption, mode: number): void;
}
