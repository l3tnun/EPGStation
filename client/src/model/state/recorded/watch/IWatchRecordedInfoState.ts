import * as apid from '../../../../../../api';

export interface DsiplayWatchInfo {
    channelName: string;
    time: string;
    name: string;
    description?: string;
}

export default interface IWatchRecordedInfoState {
    clear(): void;
    update(recordedId: apid.RecordedId): Promise<void>;
    getInfo(): DsiplayWatchInfo | null;
}
