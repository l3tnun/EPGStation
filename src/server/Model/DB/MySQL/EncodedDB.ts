import * as path from 'path';
import MySQLBase from './MySQLBase';
import * as DBSchema from '../DBSchema';
import Util from '../../../Util/Util';
import { EncodedDBInterface } from '../EncodedDB';

class EncodedDB extends MySQLBase implements EncodedDBInterface {
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
    * @return Promise<number> insertId
    */
    public async insert(recordedId: number, name: string, filePath: string): Promise<number> {
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

        return this.getInsertId(await this.runQuery(query, value));
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
    * @return Promise<DBSchema.EncodedSchema | null>
    */
    public async findId(id: number): Promise<DBSchema.EncodedSchema | null> {
        let programs = await this.runQuery(`select * from ${ DBSchema.TableName.Encoded } where id = ${ id }`);
        return this.getFirst(this.fixResult(<DBSchema.EncodedSchema[]>programs));
    }

    /**
    * @param programs: DBSchema.RecordedSchema[]
    */
    private fixResult(programs: DBSchema.EncodedSchema[]): DBSchema.EncodedSchema[] {
        let baseDir = Util.getRecordedPath();
        return programs.map((program) => {
            // path をフルパスへ書き換える
            program.path = path.join(baseDir, program.path);
            // name を string へ
            program.name = String(program.name);
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

export default EncodedDB;
