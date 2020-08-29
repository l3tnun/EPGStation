import Recorded from '../../../db/entities/Recorded';
import Reserve from '../../../db/entities/Reserve';
import { IReserveUpdateValues } from '../../event/IReserveEvent';

export default interface IExternalCommandManageModel {
    addUpdateReseves(diff: IReserveUpdateValues): void;
    addRecordingPrepStartCmd(reserve: Reserve): void;
    addRecordingPrepRecFailedCmd(reserve: Reserve): void;
    addRecordingStartCmd(recorded: Recorded): void;
    addRecordingFinishCmd(recorded: Recorded): void;
    addRecordingFailedCmd(recorded: Recorded): void;
}
