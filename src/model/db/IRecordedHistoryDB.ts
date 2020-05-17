import * as apid from '../../../api';
import RecordedHistory from '../../db/entities/RecordedHistory';

export default interface IRecordedHistoryDB {
    insertOnce(program: RecordedHistory): Promise<apid.RecordedHistoryId>;
    delete(time: apid.UnixtimeMS): Promise<void>;
}
