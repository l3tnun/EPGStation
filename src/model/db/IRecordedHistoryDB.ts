import * as apid from '../../../api';
import RecordedHistory from '../../db/entities/RecordedHistory';

export default interface IRecordedHistoryDB {
    restore(items: RecordedHistory[]): Promise<void>;
    insertOnce(program: RecordedHistory): Promise<apid.RecordedHistoryId>;
    delete(time: apid.UnixtimeMS): Promise<void>;
    findAll(): Promise<RecordedHistory[]>;
}
