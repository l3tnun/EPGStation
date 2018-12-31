import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as apid from '../../../../../api';
import FileUtil from '../../../Util/FileUtil';
import Util from '../../../Util/Util';
import { EncodedDBInterface } from '../../DB/EncodedDB';
import { RecordedDBInterface } from '../../DB/RecordedDB';
import { ServicesDBInterface } from '../../DB/ServicesDB';
import Model from '../../Model';
import { RecordingManageModelInterface } from '../Recording/RecordingManageModel';
import { ThumbnailManageModelInterface, ThumbnailRecordedProgram } from '../Thumbnail/ThumbnailManageModel';

interface ExternalFileInfo {
    recordedId: number;
    isEncoded: boolean;
    viewName: string;
    fileName: string;
    uploadPath: string;
    directory?: string;
}

interface NewRecorded {
    channelId: apid.ServiceItemId;
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
    name: string;
    description: string | null;
    extended: string | null;
    genre1: number | null;
    genre2: number | null;
    genre3: number | null;
    genre4: number | null;
    genre5: number | null;
    genre6: number | null;
    videoType: apid.ProgramVideoType | null;
    videoResolution: apid.ProgramVideoResolution | null;
    videoStreamContent: number | null;
    videoComponentType: number | null;
    audioSamplingRate: apid.ProgramAudioSamplingRate | null;
    audioComponentType: number | null;
    ruleId: number | null;
}

type DeleteOption = 'onlyTs' | 'onlyEncoded' | null;

interface RecordedManageModelInterface extends Model {
    delete(id: number, option?: DeleteOption): Promise<void>;
    deletes(ids: number[], option?: DeleteOption): Promise<number[]>;
    deleteFile(id: number): Promise<void>;
    deleteEncodedFile(encodedId: number): Promise<void>;
    deleteRule(id: number): Promise<void>;
    addThumbnail(id: number, thumbnailPath: string): Promise<void>;
    addEncodeFile(recordedId: number, name: string, filePath: string): Promise<number>;
    addRecordedExternalFile(info: ExternalFileInfo): Promise<void>;
    createNewRecorded(info: NewRecorded): Promise<number>;
    updateTsFileSize(recordedId: number): Promise<void>;
    updateEncodedFileSize(encodedId: number): Promise<void>;
    cleanup(): Promise<void>;
    regenerateThumbnail(): Promise<void>;
}

class RecordedManageModel extends Model implements RecordedManageModelInterface {
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;
    private servicesDB: ServicesDBInterface;
    private recordingManage: RecordingManageModelInterface;
    private thumbnailManage: ThumbnailManageModelInterface;

    constructor(
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
        servicesDB: ServicesDBInterface,
        recordingManage: RecordingManageModelInterface,
        thumbnailManage: ThumbnailManageModelInterface,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.encodedDB = encodedDB;
        this.servicesDB = servicesDB;
        this.recordingManage = recordingManage;
        this.thumbnailManage = thumbnailManage;
    }

    /**
     * id で指定した録画を削除
     * @param id: recorded id
     * @throws RecordingManageModelNotFoundRecordedProgram id で指定したプログラムが存在しない場合
     * @return Promise<void>
     */
    public async delete(id: number, option: DeleteOption = null): Promise<void> {
        // id で指定された recorded を取得
        const recorded = await this.recordedDB.findId(id);
        if (recorded === null) {
            // id で指定された recorded がなかった
            throw new Error('RecordingManageModelNotFoundRecordedProgram');
        }

        this.log.system.info(`delete recorded file ${ id }`);

        // エンコードデータを取得
        const encoded = await this.encodedDB.findRecordedId(id);

        if (option === null || option === 'onlyEncoded') {
            // エンコードデータを DB 上から削除
            await this.encodedDB.deleteRecordedId(id);
        }

        let deletedFromDB = false;
        if (
            option === null
            || (option === 'onlyTs' && encoded.length === 0)
            || (option === 'onlyEncoded' && recorded.recPath === null)
        ) {
            // 録画データを DB 上から削除
            await this.recordedDB.delete(id);
            deletedFromDB = true;
        }

        if (recorded.recording && (option === null || option === 'onlyTs')) {
            // 録画中なら録画停止
            this.recordingManage.stop(recorded.programId, true);
        }

        if (recorded.recPath !== null && (option === null || option === 'onlyTs')) {
            // 録画実データを削除
            if (deletedFromDB) {
                await FileUtil.promiseUnlink(recorded.recPath)
                .catch((err) => {
                    this.log.system.error(`delete recorded error: ${ id }`);
                    this.log.system.error(String(err));
                });
            } else {
                await this.deleteFile(id)
                .catch((err) => {
                    this.log.system.error(`delete recorded ts file error: ${ id }`);
                    this.log.system.error(String(err));
                });
            }
        }

        // エンコード実データを削除
        if (option === null || option === 'onlyEncoded') {
            for (const file of encoded) {
                await FileUtil.promiseUnlink(file.path)
                .catch((err) => {
                    this.log.system.error(`delete encode file error: ${ file.path }`);
                    this.log.system.error(String(err));
                });
            }
        }

        // サムネイルを削除
        if (recorded.thumbnailPath !== null && deletedFromDB) {
            await FileUtil.promiseUnlink(recorded.thumbnailPath)
            .catch((err) => {
                this.log.system.error(`recorded failed to delete thumbnail ${ id }`);
                this.log.system.error(<any> err);
            });
        }

        // delete log file
        if (recorded.logPath !== null && deletedFromDB) {
            await FileUtil.promiseUnlink(recorded.logPath)
            .catch((err) => {
                this.log.system.error(`recorded failed to delete log file ${ id }`);
                this.log.system.error(<any> err);
            });
        }
    }

    /**
     * 複数 id 指定削除
     * @param ids: recorded ids
     * @param option: DeleteOption
     * @return Promise<number[]> 削除時にエラーが発生した recorded id の配列を返す
     */
    public async deletes(ids: number[], option: DeleteOption = null): Promise<number[]> {
        const errors: number[] = [];
        for (const id of ids) {
            try {
                await this.delete(id, option);
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
        await FileUtil.promiseUnlink(recorded.recPath);

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
        await FileUtil.promiseUnlink(encoded.path);

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
            this.log.system.info(`rename file ${ info.uploadPath } to ${ filePath }`);
            await FileUtil.promiseRename(info.uploadPath, filePath);
        } catch (err) {
            this.log.system.error('rename file error');
            this.log.system.error(<any> err);

            // move を試す
            try {
                this.log.system.info(`move file ${ info.uploadPath } to ${ filePath }`);
                await FileUtil.promiseMove(info.uploadPath, filePath);
            } catch (e) {
                this.log.system.error('move file error');
                this.log.system.error(<any> e);
                await FileUtil.promiseUnlink(info.uploadPath)
                .catch(() => {});

                throw new Error('FileMoveError');
            }
        }

        // エラー時にファイルを削除する関数
        const deleteFiles = async() => {
            await FileUtil.promiseUnlink(filePath)
            .catch(() => {});
        };

        // DB に反映
        let encodedId: number | null = null;
        if (info.isEncoded) {
            // encoded file
            try {
                encodedId = await this.addEncodeFile(info.recordedId, info.viewName, filePath);
                this.log.system.info(`created new encoded: ${ encodedId }`);
            } catch (err) {
                this.log.system.error('created new encoded error');
                this.log.system.error(<any> err);
                await deleteFiles();
                throw err;
            }
        } else {
            // ts file
            if (recorded.recPath !== null) {
                // すでに ts ファイルがある場合
                this.log.system.error(`ts file already exists: ${ info.recordedId }`);
                await deleteFiles();
                throw new Error('TsFileAlreadyExists');
            }

            try {
                await this.recordedDB.updateTsFilePath(info.recordedId, filePath, false);
                await this.updateTsFileSize(info.recordedId);
                this.log.system.info(`update ts file: ${ info.recordedId }`);
            } catch (err) {
                this.log.system.error('update ts error');
                this.log.system.error(<any> err);
                await deleteFiles();
                throw err;
            }
        }

        // create thumbnail
        if (recorded.thumbnailPath === null) {
            if (encodedId !== null) {
                (<ThumbnailRecordedProgram> recorded).encodedId = encodedId;
            } else {
                recorded.recPath = filePath;
            }

            this.thumbnailManage.push(<ThumbnailRecordedProgram> recorded);
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
     * recorded を新規作成
     * @param info NewRecorded
     * @return Promise<number> recordedId
     */
    public async createNewRecorded(info: NewRecorded): Promise<number> {
        const channel = await this.servicesDB.findId(info.channelId);
        if (channel === null) { throw new Error('ChannelIdIsNotFound'); }

        const duration = Math.floor(info.endAt - info.startAt);
        if (duration < 0) { throw new Error('TimeError'); }

        const recordedId = await this.recordedDB.insert({
            id: 0,
            programId: 0,
            channelId: info.channelId,
            channelType: channel.channelType,
            startAt: info.startAt,
            endAt: info.endAt,
            duration: duration,
            name: info.name,
            description: info.description,
            extended: info.extended,
            genre1: info.genre1,
            genre2: info.genre2,
            genre3: info.genre3,
            genre4: info.genre4,
            genre5: info.genre5,
            genre6: info.genre6,
            videoType: info.videoType,
            videoResolution: info.videoResolution,
            videoStreamContent: info.videoStreamContent,
            videoComponentType: info.videoComponentType,
            audioSamplingRate: info.audioSamplingRate,
            audioComponentType: info.audioComponentType,
            recPath: null,
            ruleId: info.ruleId,
            thumbnailPath: null,
            recording: false,
            protection: false,
            filesize: null,
            logPath: null,
            errorCnt: null,
            dropCnt: null,
            scramblingCnt: null,
            isTmp: false,
        });

        this.log.system.info(`create new recorded: ${ recordedId }`);

        return recordedId;
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

    /**
     * recorded ファイルの整理
     * DB に登録されていないファイルの削除
     * @return Promise<void>
     */
    public async cleanup(): Promise<void> {
        this.log.system.info('start recorded files clean up');

        const recordedList = await FileUtil.getFileList(Util.getRecordedPath());
        const recordedFiles = await this.recordedDB.getAllFiles();
        const encodedFiles = await this.encodedDB.getAllFiles();
        const recordingFiles = await this.recordingManage.getRecordingPath();

        const fileList = recordedList;
        const logDir = Util.getDropCheckLogDir();
        if (logDir !== null) {
            const logFileList = await FileUtil.getFileList(logDir);
            Array.prototype.push.apply(fileList.files, logFileList.files);
        }

        // recorded 上に登録があるが存在しないファイルを削除する
        for (const file of recordedFiles) {
            if (file.recPath !== null && !await FileUtil.checkFile(file.recPath)) {
                this.log.system.info(`delete recorded: ${ file.id }`);
                await this.recordedDB.deleteRecPath(file.id)
                .catch((err) => {
                    this.log.system.error(`delete recorded error: ${ file.id }`);
                    this.log.system.error(err);
                });
            }
        }

        // encoded 上に登録があるが存在しないファイルを削除する
        for (const file of encodedFiles) {
            if (!await FileUtil.checkFile(file.path)) {
                this.log.system.info(`delete encoded: ${ file.id }`);
                await this.encodedDB.delete(file.id)
                .catch((err) => {
                    this.log.system.error(`delete encoded error: ${ file.id }`);
                    this.log.system.error(err);
                });
            }
        }

        // recorded 上で ts も encoded も存在しない項目を削除
        this.log.system.info('recordedDB cleanup');
        try {
            const programs = await this.recordedDB.findCleanupList();
            for (const program of programs) {
                try {
                    await this.delete(program.id);
                } catch (err) {
                    this.log.system.error(`delete recorded error: ${ program.id }`);
                    this.log.system.error(err);
                }
            }
        } catch (err) {
            this.log.system.error('recordedDB cleanup error');
            this.log.system.error(err);
        }

        // DB 上に存在しないファイルを削除する
        // ファイル検索のための索引を作成
        const filesIndex: { [key: string]: boolean } = {};
        for (const file of recordedFiles) {
            if (file.recPath !== null) {
                filesIndex[file.recPath] = true;
            }
            if (file.logPath !== null) {
                filesIndex[file.logPath] = true;
            }
        }
        for (const file of encodedFiles) { filesIndex[file.path] = true; }
        for (const file of recordingFiles) { filesIndex[file] = true; }

        // ファイルを削除
        for (const file of fileList.files) {
            if (typeof filesIndex[file] === 'undefined') {
                this.log.system.info(`delete file: ${ file }`);
                await FileUtil.promiseUnlink(file)
                .catch((err) => {
                    this.log.system.error(`delete file error: ${ file }`);
                    this.log.system.error(err);
                });
            }
        }

        // ディレクトリ検索のための索引を作成
        const directoriesIndex: { [key: string]: boolean } = {};
        for (const file of recordedFiles) {
            if (file.recPath !== null) {
                directoriesIndex[path.dirname(file.recPath)] = true;
            }
            if (file.logPath) {
                directoriesIndex[path.dirname(file.logPath)] = true;
            }
        }
        for (const file of encodedFiles) { directoriesIndex[path.dirname(file.path)] = true; }
        for (const file of recordingFiles) { directoriesIndex[path.dirname(file)] = true; }

        // 削除時にネストが深いディレクトリから削除するためソート
        fileList.directories.sort((dir1, dir2) => { return dir2.length - dir1.length;  });

        // ディレクトリ削除
        for (const directory of fileList.directories) {
            if (typeof directoriesIndex[directory] === 'undefined') {
                this.log.system.info(`delete directory: ${ directory }`);
                try {
                    const isEmpty = await FileUtil.isEmptyDirectory(directory);
                    if (isEmpty) {
                        await FileUtil.promiseRmdir(directory);
                    } else {
                        this.log.system.warn(`directory is not empty: ${ directory }`);
                    }
                } catch (err) {
                    this.log.system.error(`delete directory error: ${ directory }`);
                    this.log.system.error(err);
                }
            }
        }

        this.log.system.info('recorded files clean up completed');
    }

    /**
     * サムネイル再生成
     * @return Promise<void>
     */
    public async regenerateThumbnail(): Promise<void> {
        this.log.system.info('start regenerate thumbnail request');

        const recordeds = await this.recordedDB.findAll();

        for (const recorded of recordeds) {
            // サムネイルが存在しているか確認
            if (recorded.thumbnailPath !== null) {
                try {
                    fs.statSync(recorded.thumbnailPath);
                    continue;
                }  catch (e) {
                }
            }

            let sourcePath: string | null = null;
            if (recorded.recPath === null) {
                // encoded からファイルパスを取得する
                const encodeds = await this.encodedDB.findRecordedId(recorded.id);
                if (encodeds.length > 0) {
                    sourcePath = encodeds[0].path;
                    (<ThumbnailRecordedProgram> recorded).encodedId = encodeds[0].id;
                }
            } else {
                // ts ファイルあり
                sourcePath = recorded.recPath;
            }

            if (sourcePath === null) {
                this.log.system.error(`recordedId: ${ recorded.id } does not have video file`);
                continue;
            }

            // サムネイルの再生成を依頼
            this.log.system.info(`regenerate thumbnail: ${ recorded.id }`);
            this.thumbnailManage.push(<ThumbnailRecordedProgram> recorded);
        }

        this.log.system.info('regenerate thumbnail request completed');
    }
}

export { DeleteOption, ExternalFileInfo, NewRecorded, RecordedManageModelInterface, RecordedManageModel };

