import DBBase from './DBBase';
import * as path from 'path';
import * as DBSchema from './DBSchema';
import Util from '../../Util/Util';

interface EncodedDBInterface extends DBBase {
    create(): Promise<void>;
    insert(recordedId: number, name: string, path: string): Promise<number>;
    delete(id: number): Promise<void>;
    deleteRecordedId(recordedId: number): Promise<void>;
    findId(id: number): Promise<DBSchema.EncodedSchema | null>;
    findRecordedId(recordedId: number): Promise<DBSchema.EncodedSchema[]>;
}

/**
* EncodedDB クラス
* 各 DB で共通部分をまとめる
*/
abstract class EncodedDB extends DBBase implements EncodedDBInterface {
    /**
    * create table
    * @return Promise<void>
    */
    abstract create(): Promise<void>;

    /**
    * encoded 挿入
    * @param recordedId: recordedId
    * @param name: name
    * @para, filePath: file path
    * @return Promise<number> insertId
    */
    public insert(recordedId: number, name: string, filePath: string): Promise<number> {
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

        return this.operator.runInsert(query, value);
    }

    /**
    * encoded を削除
    * @param id: encoded id
    * @return Promise<void>
    */
    public delete(id: number): Promise<void> {
        return this.operator.runQuery(`delete from ${ DBSchema.TableName.Encoded } where id = ${ id }`);
    }

    /**
    * encoded を recorded id を指定して削除
    * @param recordedId: recorded id
    * @return Promise<void>
    */
    public deleteRecordedId(recordedId: number): Promise<void> {
        return this.operator.runQuery(`delete from ${ DBSchema.TableName.Encoded } where recordedId = ${ recordedId }`);
    }

    /**
    * id 検索
    * @param id: encoded id
    * @return Promise<DBSchema.EncodedSchema | null>
    */
    public async findId(id: number): Promise<DBSchema.EncodedSchema | null> {
        let programs = await this.operator.runQuery(`select * from ${ DBSchema.TableName.Encoded } where id = ${ id }`);
        return this.operator.getFirst(this.fixResult(<DBSchema.EncodedSchema[]>programs));
    }

    /**
    * @param programs: DBSchema.RecordedSchema[]
    */
    protected fixResult(programs: DBSchema.EncodedSchema[]): DBSchema.EncodedSchema[] {
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
        let programs = await this.operator.runQuery(`select * from ${ DBSchema.TableName.Encoded } where recordedId = ${ recordedId }`);
        return this.fixResult(<DBSchema.EncodedSchema[]>programs);
    }
}

export { EncodedDBInterface, EncodedDB };
