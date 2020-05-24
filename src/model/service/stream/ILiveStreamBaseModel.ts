import * as apid from '../../../../api';
import { IStreamBase } from './IStreamBaseModel';

export type LiveStreamModelProvider = () => Promise<ILiveStreamBaseModel>;

export interface LiveStreamOption {
    channelId: apid.ChannelId;
    cmd?: string;
}

export default interface ILiveStreamBaseModel extends IStreamBase<LiveStreamOption> {
    setOption(option: LiveStreamOption): void;
}
