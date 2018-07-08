import * as path from 'path';
import FileUtil from '../../Util/FileUtil';
import Util from '../../Util/Util';
import * as DBSchema from './DBSchema';
import DBTableBase from './DBTableBase';

interface EncodedDBInterface extends DBTableBase {
    create(): Promise<void>;
    drop(): Promise<void>;
    insert(recordedId: number, name: string, path: string, filesize: number | null): Promise<number>;
    restore(programs: DBSchema.EncodedSchema[], isDelete?: boolean, hasBaseDir?: boolean): Promise<void>;
    delete(id: number): Promise<void>;
    deleteRecordedId(recordedId: number): Promise<void>;
    updateAllNullFileSize(): Promise<void>;
    updateFileSize(encodedId: number): Promise<void>;
    findId(id: number): Promise<DBSchema.EncodedSchema | null>;
    findAll(sAddBaseDir?: boolean): Promise<DBSchema.EncodedSchema[]>;
    findRecordedId(recordedId: number): Promise<DBSchema.EncodedSchema[]>;
    getAllFiles(): Promise<{ id: number; path: string }[]>;
}

/**
 * EncodedDB クラス
 * 各 DB で共通部分をまとめる
 */
abstract class EncodedDB extends DBTableBase implements EncodedDBInterface {
    /**
     * get table name
     * @return string
     */
    protected getTableName(): string {
        return DBSchema.TableName.Encoded;
    }

    /**
     * create table
     * @return Promise<void>
     */
    public abstract create(): Promise<void>;

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
     * @param filePath: file path
     * @param fileSize: file size
     * @return Promise<number> insertId
     */
    public insert(recordedId: number, name: string, filePath: string, filesize: number | null): Promise<number> {
        const query = `insert into ${ DBSchema.TableName.Encoded } (`
            + this.createInsertColumnStr(false)
        + ') VALUES ('
            + this.operator.createValueStr(1, 4)
        + `) ${ this.operator.getReturningStr() }`;

        const value: any[] = [
            recordedId,
            name,
            filePath.slice(Util.getRecordedPath().length + path.sep.length),
            filesize,
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
            + 'recordedId, '
            + 'name, '
            + 'path, '
            + 'filesize ';
    }

    /**
     * resotre
     * @param programs: DBSchema.EncodedSchema[]
     * @param isDelete: boolean = true
     * @param hasBaseDir: boolean = true
     */
    public restore(programs: DBSchema.EncodedSchema[], isDelete: boolean = true, hasBaseDir: boolean = true): Promise<void> {
        const query = `insert into ${ DBSchema.TableName.Encoded } (`
            + this.createInsertColumnStr(true)
        + ') VALUES ('
            + this.operator.createValueStr(1, 5)
        + ')';

        const values: any[] = [];
        for (const program of programs) {
            const value: any[] = [
                program.id,
                program.recordedId,
                program.name,
                hasBaseDir ? program.path.slice(Util.getRecordedPath().length + path.sep.length) : program.path,
                program.filesize,
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
     * filesize が null のデータを更新する
     * @return Promise<void>
     */
    public async updateAllNullFileSize(): Promise<void> {
        let programs = <DBSchema.EncodedSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Encoded } where filesize is null`);
        programs = this.fixResults(programs);

        for (const program of programs) {
            try {
                const size = FileUtil.getFileSize(program.path);
                await this.operator.runQuery(`update ${ DBSchema.TableName.Encoded } set filesize = ${ size } where id = ${ program.id }`);
            } catch (err) {
                this.log.system.warn(`${ program.path } update filesize error.`);
            }
        }
    }

    /**
     * filesize を更新する
     * @param encodedId: encoded Id
     * @return Promise<void>
     */
    public async updateFileSize(encodedId: number): Promise<void> {
        const encoded = await this.findId(encodedId);
        if (encoded === null || encoded.filesize === null) { return; }

        const size = FileUtil.getFileSize(encoded.path);
        await this.operator.runQuery(`update ${ DBSchema.TableName.Encoded } set filesize = ${ size } where id = ${ encodedId }`);
    }

    /**
     * id 検索
     * @param id: encoded id
     * @return Promise<DBSchema.EncodedSchema | null>
     */
    public async findId(id: number): Promise<DBSchema.EncodedSchema | null> {
        const programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Encoded } where id = ${ id }`);

        return this.operator.getFirst(this.fixResults(<DBSchema.EncodedSchema[]> programs));
    }

    /**
     * @param programs: DBSchema.RecordedSchema[]
     * @param isAddBaseDir: boolean = true
     */
    protected fixResults(programs: DBSchema.EncodedSchema[], isAddBaseDir: boolean = true): DBSchema.EncodedSchema[] {
        const baseDir = Util.getRecordedPath();

        return programs.map((program) => {
            if (isAddBaseDir) {
                // path をフルパスへ書き換える
                program.path = this.fixPath(baseDir, program.path);
            }
            // name を string へ
            program.name = String(program.name);

            return program;
        });
    }

    /**
     * path 修正
     * @param baseDir: string
     * @param filePath: string
     * @return string
     */
    private fixPath(baseDir: string, filePath: string): string {
        return path.join(baseDir, filePath);
    }

    /**
     * 全件取得
     * @param isAddBaseDir: boolean
     * @return Promise<DBSchema.EncodedSchema[]>
     */
    public async findAll(isAddBaseDir: boolean = true): Promise<DBSchema.EncodedSchema[]> {
        const query = `select ${ this.getAllColumns() } from ${ DBSchema.TableName.Encoded } order by id desc`;

        const programs = await this.operator.runQuery(query);

        return this.fixResults(<DBSchema.EncodedSchema[]> programs, isAddBaseDir);
    }

    /**
     * recorded id 検索
     * @param recordedId: recorded id
     * @return Promise<DBSchema.EncodedSchema[]>
     */
    public async findRecordedId(recordedId: number): Promise<DBSchema.EncodedSchema[]> {
        const programs = await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Encoded } where recordedId = ${ recordedId } order by id asc`);

        return this.fixResults(<DBSchema.EncodedSchema[]> programs);
    }

    /**
     * ファイルパス一覧を取得
     * @return Promise<{ id: number; path: string }[]>
     */
    public async getAllFiles(): Promise<{ id: number; path: string }[]> {
        const results = <{ id: number; path: string }[]> await this.operator.runQuery(`select id, path from ${ DBSchema.TableName.Encoded }`);

        const baseDir = Util.getRecordedPath();

        return results.map((result) => {
            return {
                id: result.id,
                path: this.fixPath(baseDir, result.path),
            };
        });
    }
}

export { EncodedDBInterface, EncodedDB };

