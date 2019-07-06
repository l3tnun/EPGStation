import { RecordedHistoryDBInterface } from '../DB/RecordedHistoryDB';
import ApiModel from './ApiModel';

interface RecordedHistoryModelInterface extends ApiModel {
    clearAll(): Promise<void>;
}

class RecordedHistoryModel extends ApiModel implements RecordedHistoryModelInterface {
    private recordedHistoryDB: RecordedHistoryDBInterface;

    constructor(recordedHistoryDB: RecordedHistoryDBInterface) {
        super();

        this.recordedHistoryDB = recordedHistoryDB;
    }

    /**
     * 全ての録画履歴をを削除
     */
    public async clearAll(): Promise<void> {
        await this.recordedHistoryDB.deleteAll();
    }
}

export { RecordedHistoryModelInterface, RecordedHistoryModel };

