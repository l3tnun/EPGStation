import * as path from 'path';
import DBBase from './DBBase';
import * as DBSchema from './DBSchema';
import Util from '../../Util/Util';

interface EncodedDBInterface extends DBBase {
    create(): Promise<void>;
    insert(recordedId: number, name: string, path: string): Promise<any>;
    deleteRecordedId(recordedId: number): Promise<void>;
    findId(id: number): Promise<DBSchema.EncodedSchema[]>;
    findRecordedId(recordedId: number): Promise<DBSchema.EncodedSchema[]>;
}

class EncodedDB extends DBBase implements EncodedDBInterface {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `CREATE TABLE IF NOT EXISTS ${ DBSchema.TableName.Encoded } (`
            + 'id int primary key auto_increment, '
            + 'recordedId int, '
            + 'name text not null, '
            + 'path text not null, '
            + `foreign key(recordedId) references ${ DBSchema.TableName.Recorded }(id) `
        + ') engine=InnoDB;'

        return this.runQuery(query);
    }

    /**
    * encoded 挿入
    * @param recordedId: recordedId
    * @param name: name
    * @para, filePath: file path
    * @return Promise<any>
    */
    public insert(recordedId: number, name: string, filePath: string): Promise<any> {
        let query = `insert into ${ DBSchema.TableName.Encoded } (`
            + 'recordedId,'
            + 'name, '
            + 'path '
        + ') VALUES ('
            + '?, ?, ?'
        + ');'

        let value: any[] = [
            recordedId,
            name,
            filePath.slice(Util.getRecordedPath().length + path.sep.length),
        ];

        return this.runQuery(query, value);
    }

    /**
    * encoded を削除
    * @param id: encoded id
    * @return Promise<void>
    */
    public delete(id: number): Promise<void> {
        return this.runQuery(`delete from ${ DBSchema.TableName.Encoded } where id = ${ id }`);
    }

    /**
    * encoded を recorded id を指定して削除
    * @param recordedId: recorded id
    * @return Promise<void>
    */
    public deleteRecordedId(recordedId: number): Promise<void> {
        return this.runQuery(`delete from ${ DBSchema.TableName.Encoded } where recordedId = ${ recordedId }`);
    }

    /**
    * id 検索
    * @param id: encoded id
    * @return Promise<DBSchema.EncodedSchema[]>
    */
    public async findId(id: number): Promise<DBSchema.EncodedSchema[]> {
        let programs = await this.runQuery(`select * from ${ DBSchema.TableName.Encoded } where id = ${ id }`);
        return this.fixResult(<DBSchema.EncodedSchema[]>programs);
    }

    /**
    * path をフルパスへ書き換える
    * @param programs: DBSchema.RecordedSchema[]
    */
    private fixResult(programs: DBSchema.EncodedSchema[]): DBSchema.EncodedSchema[] {
        let baseDir = Util.getRecordedPath();
        return programs.map((program) => {
            program.path = path.join(baseDir, program.path);
            return program;
        });
    }

    /**
    * recorded id 検索
    * @param recordedId: recorded id
    * @return Promise<DBSchema.EncodedSchema[]>
    */
    public async findRecordedId(recordedId: number): Promise<DBSchema.EncodedSchema[]> {
        let programs = await this.runQuery(`select * from ${ DBSchema.TableName.Encoded } where recordedId = ${ recordedId }`);
        return this.fixResult(<DBSchema.EncodedSchema[]>programs);
    }
}

export { EncodedDBInterface, EncodedDB };
