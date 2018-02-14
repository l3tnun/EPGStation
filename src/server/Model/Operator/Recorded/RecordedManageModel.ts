import * as fs from 'fs';
import Model from '../../Model';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { EncodedDBInterface } from '../../DB/EncodedDB';
import FileUtil from '../../../Util/FileUtil';

interface RecordedManageModelInterface extends Model {
    addEncodeFile(recordedId: number, name: string, filePath: string, delTs: boolean): Promise<number>;
}

class RecordedManageModel extends Model implements RecordedManageModelInterface {
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;


    constructor(
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.encodedDB = encodedDB;
    }

    /**
    * エンコードしたファイルのパスを追加する
    * @param id: recorded id
    * @param filePath: encode file path
    * @return Promise<void>
    */
    public async addEncodeFile(recordedId: number, name: string, filePath: string, delTs: boolean): Promise<number> {
        this.log.system.info(`add encode file: ${ recordedId }`);

        // DB にエンコードファイルを追加
        const encodedId = await this.encodedDB.insert(recordedId, name, filePath, FileUtil.getFileSize(filePath));

        // ts 削除
        if(delTs) {
            let recorded = await this.recordedDB.findId(recordedId);

            //削除するデータがある場合
            if(recorded !== null && recorded.recPath !== null) {
                //削除
                fs.unlink(recorded.recPath, (err) => {
                    this.log.system.info(`delete ts file: ${ recordedId }`);
                    if(err) {
                        this.log.system.error(`delete ts file error: ${ recordedId }`);
                    }
                });

                // DB 上から recPath を削除
                await this.recordedDB.deleteRecPath(recordedId);
            }
        }

        return encodedId;
    }
}

export { RecordedManageModelInterface, RecordedManageModel }

