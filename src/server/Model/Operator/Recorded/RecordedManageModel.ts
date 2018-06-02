import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import FileUtil from '../../../Util/FileUtil';
import Util from '../../../Util/Util';
import { EncodedDBInterface } from '../../DB/EncodedDB';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import Model from '../../Model';
import { RecordingManageModelInterface } from '../Recording/RecordingManageModel';

interface ExternalFileInfo {
    recordedId: number;
    isEncoded: boolean;
    viewName: string;
    fileName: string;
    uploadPath: string;
    directory?: string;
}

interface RecordedManageModelInterface extends Model {
    delete(id: number): Promise<void>;
    deletes(ids: number[]): Promise<number[]>;
    deleteFile(id: number): Promise<void>;
    deleteEncodedFile(encodedId: number): Promise<void>;
    deleteRule(id: number): Promise<void>;
    addThumbnail(id: number, thumbnailPath: string): Promise<void>;
    addEncodeFile(recordedId: number, name: string, filePath: string): Promise<number>;
    addRecordedExternalFile(info: ExternalFileInfo): Promise<void>;
    updateTsFileSize(recordedId: number): Promise<void>;
    updateEncodedFileSize(encodedId: number): Promise<void>;
}

class RecordedManageModel extends Model implements RecordedManageModelInterface {
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;
    private recordingManage: RecordingManageModelInterface;

    constructor(
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
        recordingManage: RecordingManageModelInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.encodedDB = encodedDB;
        this.recordingManage = recordingManage;
    }

    /**
     * id で指定した録画を削除
     * @param id: recorded id
     * @throws RecordingManageModelNotFoundRecordedProgram id で指定したプログラムが存在しない場合
     * @return Promise<void>
     */
    public async delete(id: number): Promise<void> {
        // id で指定された recorded を取得
        const recorded = await this.recordedDB.findId(id);
        if (recorded === null) {
            // id で指定された recorded がなかった
            throw new Error('RecordingManageModelNotFoundRecordedProgram');
        }

        this.log.system.info(`delete recorded file ${ id }`);

        // エンコードデータを取得
        const encoded = await this.encodedDB.findRecordedId(id);

        // エンコードデータを DB 上から削除
        await this.encodedDB.deleteRecordedId(id);
        // 録画データを DB 上から削除
        await this.recordedDB.delete(id);

        if (recorded.recording) {
            // 録画中なら録画停止
            this.recordingManage.stop(recorded.programId);
        }

        if (recorded.recPath !== null) {
            // 録画実データを削除
            fs.unlink(recorded.recPath, (err) => {
            if (err) {
                    this.log.system.error(`delete recorded error: ${ id }`);
                    this.log.system.error(String(err));
                }
            });
        }

        // エンコード実データを削除
        for (const file of encoded) {
            fs.unlink(file.path, (err) => {
                if (err) {
                    this.log.system.error(`delete encode file error: ${ file.path }`);
                    this.log.system.error(String(err));
                }
            });
        }

        // サムネイルを削除
        if (recorded.thumbnailPath !== null) {
            fs.unlink(recorded.thumbnailPath, (err) => {
                if (err) {
                    this.log.system.error(`recorded failed to delete thumbnail ${ id }`);
                    this.log.system.error(String(err));
                }
            });
        }
    }

    /**
     * 複数 id 指定削除
     * @param ids: recorded ids
     * @return Promise<number[]> 削除時にエラーが発生した recorded id の配列を返す
     */
    public async deletes(ids: number[]): Promise<number[]> {
        const errors: number[] = [];
        for (const id of ids) {
            try {
                await this.delete(id);
            } catch (err) {
                errors.push(id);
            }
        }

        return errors;
    }

    /**
     * ts ファイル削除
     * @param id: recorded id
     */
    public async deleteFile(id: number): Promise<void> {
        const recorded = await this.recordedDB.findId(id);

        if (recorded === null || recorded.recPath === null) { throw new Error('RecordedTsFileIsNotFound'); }

        // ファイル削除
        fs.unlink(recorded.recPath, (err) => {
            if (err) { throw err; }
        });

        // DB 上から削除
        await this.recordedDB.deleteRecPath(id);
    }

    /**
     * encoded ファイル削除
     * @param encodedId: encoded id
     */
    public async deleteEncodedFile(encodedId: number): Promise<void> {
        const encoded = await this.encodedDB.findId(encodedId);
        if (encoded === null) { throw new Error('EncodedFileIsNotFound'); }

        // ファイル削除
        fs.unlink(encoded.path, (err) => {
            if (err) { throw err; }
        });

        // DB 上から削除
        await this.encodedDB.delete(encodedId);
    }

    /**
     * id で指定した ruleId をもつ recorded 内のプログラムの ruleId をすべて削除(nullにする)
     * rule が削除されたときに呼ぶ
     * @param id: rule id
     */
    public deleteRule(id: number): Promise<void> {

        this.log.system.info(`delete recorded program ruleId ${ id }`);

        return this.recordedDB.deleteRuleId(id);
    }

    /**
     * サムネイルのパスを追加する
     * @param id: recorded id
     * @param thumbnailPath: thumbnail file path
     * @return Promise<void>
     */
    public addThumbnail(id: number, thumbnailPath: string): Promise<void> {
        this.log.system.info(`add thumbnail: ${ id }`);

        return this.recordedDB.addThumbnail(id, thumbnailPath);
    }

    /**
     * エンコードしたファイルのパスを追加する
     * @param id: recorded id
     * @param filePath: encode file path
     * @return Promise<void>
     */
    public async addEncodeFile(recordedId: number, name: string, filePath: string): Promise<number> {
        this.log.system.info(`add encode file: ${ recordedId }`);

        // DB にエンコードファイルを追加
        const encodedId = await this.encodedDB.insert(recordedId, name, filePath, FileUtil.getFileSize(filePath));

        return encodedId;
    }

    /**
     * アップロードされた動画ファイルを追加する
     * @param info: ExternalFileInfo
     * @return Promise<void>
     */
    public async addRecordedExternalFile(info: ExternalFileInfo): Promise<void> {
        this.log.system.info(`add external file: ${ info.recordedId }`);

        // 指定された recorded を取得
        const recorded = await this.recordedDB.findId(info.recordedId);
        if (recorded === null) {
            // id で指定された recorded がなかった
            throw new Error('RecordedIdIsNotFound');
        }

        // dir
        let dir = Util.getRecordedPath();
        if (typeof info.directory !== 'undefined') {
            dir = path.join(dir, info.directory);

            // check dir
            try {
                fs.statSync(dir);
            } catch (err) {
                // mkdir directory
                this.log.system.info(`mkdirp: ${ dir }`);
                mkdirp.sync(dir);
            }
        }

        // get file path
        const filePath = this.getExternalFilePath(dir, info.fileName);

        // move file
        try {
            await FileUtil.promiseRename(info.uploadPath, filePath);
        } catch (err) {
            await FileUtil.promiseUnlink(info.uploadPath)
            .catch(() => {});
            await FileUtil.promiseUnlink(filePath)
            .catch(() => {});

            throw err;
        }

        // エラー時にファイルを削除する関数
        const deleteFiles = async() => {
            await FileUtil.promiseUnlink(filePath)
            .catch(() => {});
        };

        // DB に反映
        if (info.isEncoded) {
            // encoded file
            try {
                await this.addEncodeFile(info.recordedId, info.viewName, filePath);
            } catch (err) {
                await deleteFiles();
                throw err;
            }
        } else {
            // ts file
            if (recorded.recPath !== null) {
                // すでに ts ファイルがある場合
                this.log.system.error(`ts file already exists: ${ info.recordedId }`);
                throw new Error('TsFileAlreadyExists');
            }

            try {
                await this.recordedDB.updateTsFilePath(info.recordedId, filePath);
                await this.updateTsFileSize(info.recordedId);
            } catch (err) {
                await deleteFiles();
                throw err;
            }
        }

        // TODO create thumbnail
        if (recorded.thumbnailPath === null) {
        }
    }

    /**
     * アップロードファイルの file path を取得する
     * @param dir: directory
     * @param fileName: file name
     * @param conflict: 同名ファイルがあった場合カウントされる
     * @return string
     */
    private getExternalFilePath(dir: string, fileName: string, conflict: number = 0): string {
        const extname = path.extname(fileName);
        const name = fileName.slice(0, fileName.length - extname.length);
        const count = conflict > 0 ? `(${ conflict })` : '';

        const filePath = path.join(dir, `${ name }${ count }${ extname }`);

        try {
            // 同盟のファイルが存在するか確認
            fs.statSync(filePath);

            return this.getExternalFilePath(dir, fileName, conflict + 1);
        } catch (err) {
            return filePath;
        }
    }

    /**
     * ts ファイルのサイズを更新
     * @param recordedId: recorded id
     * @return Promise<void>
     */
    public async updateTsFileSize(recordedId: number): Promise<void> {
        await this.recordedDB.updateFileSize(recordedId);
    }

    /**
     * encoded ファイルのサイズを更新
     * @param encodedId: encoded id
     * @return Promise<void>
     */
    public async updateEncodedFileSize(encodedId: number): Promise<void> {
        await this.encodedDB.updateFileSize(encodedId);
    }
}

export { ExternalFileInfo, RecordedManageModelInterface, RecordedManageModel };

