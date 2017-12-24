import DBBase from './DBBase';
import * as path from 'path';
import * as DBSchema from './DBSchema';
import Util from '../../Util/Util';

interface EncodedDBInterface extends DBBase {
    create(): Promise<void>;
    drop(): Promise<void>;
    insert(recordedId: number, name: string, path: string): Promise<number>;
    restore(programs: DBSchema.EncodedSchema[], isDelete?: boolean, hasBaseDir?: boolean): Promise<void>;
    delete(id: number): Promise<void>;
    deleteRecordedId(recordedId: number): Promise<void>;
    findId(id: number): Promise<DBSchema.EncodedSchema | null>;
    findAll(sAddBaseDir?: boolean): Promise<DBSchema.EncodedSchema[]>;
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
    * drop table
    */
    public drop(): Promise<void> {
        return this.operator.runQuery(`drop table if exists ${ DBSchema.TableName.Encoded }`);
    }

    /**
    * encoded 挿入
    * @param recordedId: recordedId
    * @param name: name
    * @para, filePath: file path
    * @return Promise<number> insertId
    */
    public insert(recordedId: number, name: string, filePath: string): Promise<number> {
        let query = `insert into ${ DBSchema.TableName.Encoded } (`
            + this.createInsertColumnStr(false)
        + ') VALUES ('
            + this.operator.createValueStr(1, 3)
        + `) ${ this.operator.getReturningStr() }`;

        let value: any[] = [
            recordedId,
            name,
            filePath.slice(Util.getRecordedPath().length + path.sep.length),
        ];

        return this.operator.runInsert(query, value);
    }

    /**
    * insert 時のカラムを生成
    * @param hasId: boolean
    * @return string
    */
    private createInsertColumnStr(hasId: boolean): string {
        return (hasId ? 'id, ' : '')
            + 'recordedId,'
            + 'name, '
            + 'path '
    }

    /**
    * resotre
    * @param programs: DBSchema.EncodedSchema[]
    * @param isDelete: boolean = true
    * @param hasBaseDir: boolean = true
    */
    public restore(programs: DBSchema.EncodedSchema[], isDelete: boolean = true, hasBaseDir: boolean = true): Promise<void> {
        let query = `insert into ${ DBSchema.TableName.Encoded } (`
            + this.createInsertColumnStr(true)
        + ') VALUES ('
            + this.operator.createValueStr(1, 4)
        + `)`;

        let values: any[] = [];
        for(let program of programs) {
            let value: any[] = [
                program.id,
                program.recordedId,
                program.name,
                hasBaseDir ? program.path.slice(Util.getRecordedPath().length + path.sep.length) : program.path,
            ];

            values.push({query: query, values: value });
        }

        return this.operator.manyInsert(DBSchema.TableName.Encoded, values, isDelete);
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
        let programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Encoded } where id = ${ id }`);
        return this.operator.getFirst(this.fixResults(<DBSchema.EncodedSchema[]>programs));
    }

    /**
    * @param programs: DBSchema.RecordedSchema[]
    * @param isAddBaseDir: boolean = true
    */
    protected fixResults(programs: DBSchema.EncodedSchema[], isAddBaseDir: boolean = true): DBSchema.EncodedSchema[] {
        let baseDir = Util.getRecordedPath();
        return programs.map((program) => {
            if(isAddBaseDir) {
                // path をフルパスへ書き換える
                program.path = path.join(baseDir, program.path);
            }
            // name を string へ
            program.name = String(program.name);
            return program;
        });
    }

    /**
    * 全件取得
    *
    */
    public async findAll(isAddBaseDir: boolean = true): Promise<DBSchema.EncodedSchema[]> {
        let query = `select ${ this.getAllColumns() } from ${ DBSchema.TableName.Encoded } order by id desc`;

        let programs = await this.operator.runQuery(query);
        return this.fixResults(<DBSchema.EncodedSchema[]>programs, isAddBaseDir);
    }

    /**
    * recorded id 検索
    * @param recordedId: recorded id
    * @return Promise<DBSchema.EncodedSchema[]>
    */
    public async findRecordedId(recordedId: number): Promise<DBSchema.EncodedSchema[]> {
        let programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Encoded } where recordedId = ${ recordedId } order by id asc`);
        return this.fixResults(<DBSchema.EncodedSchema[]>programs);
    }
}

export { EncodedDBInterface, EncodedDB };
