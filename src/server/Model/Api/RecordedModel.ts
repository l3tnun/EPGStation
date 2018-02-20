import * as path from 'path';
import ApiModel from './ApiModel';
import { IPCClientInterface } from '../IPC/IPCClient';
import { findQuery, RecordedDBInterface } from '../DB/RecordedDB';
import { EncodedDBInterface } from '../DB/EncodedDB';
import { RulesDBInterface } from '../DB/RulesDB';
import { ServicesDBInterface } from '../DB/ServicesDB';
import * as DBSchema from '../DB/DBSchema';
import ApiUtil from './ApiUtil';
import { EncodeProgram, EncodeManageModelInterface } from '../Service/Encode/EncodeManageModel';
import { StreamManageModelInterface } from '../Service/Stream/StreamManageModel';
import { PLayList } from './PlayListInterface';
import Util from '../../Util/Util';

interface recordedFilePathInfo {
    path: string;
    mime: string;
}

type encodingInfoIndex = { [key: number]: { name: string, isEncoding: boolean }[] }

interface EncodeAddOption {
    mode: number;
    encodedId?: number;
    directory?: string;
    isOutputTheOriginalDirectory?: boolean;
}

interface RecordedModelInterface extends ApiModel {
    getAll(limit: number, offset: number, option?: findQuery): Promise<{}[]>
    getId(recordedId: number): Promise<{}>;
    getThumbnailPath(recordedId: number): Promise<string>;
    getFilePath(recordedId: number, encodedId: number | undefined): Promise<recordedFilePathInfo>;
    deleteAllRecorded(recordedId: number): Promise<void>
    deleteRecorded(recordedId: number, encodedId: number | undefined): Promise<void>;
    getGenreTags(): Promise<{}>;
    getM3u8(host: string, isSecure: boolean, recordedId: number, encodedId: number | undefined): Promise<PLayList>;
    sendToKodi(host: string, isSecure: boolean, kodi: number, recordedId: number, encodedId: number | undefined): Promise<void>;
    addEncode(recordedId: number, option: EncodeAddOption): Promise<void>;
    cancelEncode(recordedId: number): Promise<void>;
}

namespace RecordedModelInterface {
    export const NotFoundRecordedIdError = 'NotFoundRecordedId';
    export const NotFoundRecordedThumbnailError = 'NotFoundRecordedThumbnail';
    export const NotFoundRecordedFileError = 'NotFoundRecordedFile';
    export const RecordedIsStreamingNowError = 'RecordedIsStreamingNow';
    export const DeleteFileError = 'DeleteFileError';
    export const FileIsLockedError = 'FileIsLocked'
    export const EncodeModeIsNotFoundError = 'EncodeModeIsNotFound';
    export const IsRecordingError = 'IsRecording';
}

class RecordedModel extends ApiModel implements RecordedModelInterface {
    private ipc: IPCClientInterface;
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;
    private rulesDB: RulesDBInterface;
    private servicesDB: ServicesDBInterface;
    private encodeManage: EncodeManageModelInterface;
    private streamManage: StreamManageModelInterface;

    constructor(
        ipc: IPCClientInterface,
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
        rulesDB: RulesDBInterface,
        servicesDB: ServicesDBInterface,
        encodeManage: EncodeManageModelInterface,
        streamManage: StreamManageModelInterface,
    ) {
        super();
        this.ipc = ipc;
        this.recordedDB = recordedDB;
        this.encodedDB = encodedDB;
        this.rulesDB = rulesDB;
        this.servicesDB = servicesDB;
        this.encodeManage = encodeManage;
        this.streamManage = streamManage;
    }

    /**
    * recorded をすべて取得
    * @param limit: number | undefined
    * @param offset: number
    * @return Promise<any>
    */
    public async getAll(limit: number, offset: number, query: findQuery = {}): Promise<any> {
        let datas = await this.recordedDB.findAll({
            limit: limit,
            offset: offset,
            query: query,
        });
        let total = await this.recordedDB.getTotal(query);
        let infoIndex = await this.getEncodingInfoIndex();

        let results: any[] = [];
        for(let i = 0; i < datas.length; i++) {
            let encodedFiles = await this.encodedDB.findRecordedId(datas[i].id);
            let encodingInfo = infoIndex[datas[i].id];
            if(typeof encodingInfo !== 'undefined') { datas[i]['encoding'] = encodingInfo; }
            results.push(this.fixResult(datas[i], encodedFiles));
        }

        return {
            recorded: results,
            total: total
        }
    }

    /**
    * encodingInfo を取得
    * @return Promise<encodingInfoIndex>
    */
    private async getEncodingInfoIndex(): Promise<encodingInfoIndex> {
        let encodingInfo = await this.encodeManage.getEncodingInfo();

        let encoding: encodingInfoIndex = {};

        let config = this.config.getConfig().encode;
        if(typeof config !== 'undefined') {
            //エンコード中
            if(encodingInfo.encoding !== null) {
                if(typeof encoding[encodingInfo.encoding.recordedId] === 'undefined') {
                    encoding[encodingInfo.encoding.recordedId] = [];
                }

                encoding[encodingInfo.encoding.recordedId].push({
                    name: encodingInfo.encoding.name,
                    isEncoding: true,
                });
            }

            //エンコード待機中
            for(let program of encodingInfo.queue) {
                if(typeof encoding[program.recordedId] === 'undefined') {
                    encoding[program.recordedId] = [];
                }

                encoding[program.recordedId].push({
                    name: program.name,
                    isEncoding: false,
                });
            }
        }

        return encoding;
    }

    /**
    * recorded を id 取得
    * @param recordedId: recorded id
    * @return Promise<{}>
    */
    public async getId(recordedId: number): Promise<{}> {
        let recorded = await this.recordedDB.findId(recordedId);
        let infoIndex = await this.getEncodingInfoIndex();

        if(recorded === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedIdError);
        }

        let encodedFiles = await this.encodedDB.findRecordedId(recordedId);

        let encodingInfo = infoIndex[recordedId];
        if(typeof encodingInfo !== 'undefined') { recorded['encoding'] = encodingInfo; }
        return this.fixResult(recorded, encodedFiles);
    }

    /**
    * DBSchema.RecordedSchema の boolean 値を number から boolean へ正す
    * @param data: DBSchema.RecordedSchema
    * @return {};
    */
    private fixResult(data: {}, encodedFiles: DBSchema.EncodedSchema[]): {} {
        delete data['duration'];

        // thumbnaul があるか
        data['hasThumbnail'] = data['thumbnailPath'] !== null
        delete data['thumbnailPath'];

        data['recording'] = data['recording'];

        data['original'] = data['recPath'] !== null

        if(data['recPath'] !== null) {
            data['filename'] = encodeURIComponent(path.basename(String(data['recPath'])));
        }
        delete data['recPath'];

        // エンコードファイルを追加
        if(encodedFiles.length > 0) {
            data['encoded'] = encodedFiles.map((file) => {
                let encoded = {
                    encodedId: file.id,
                    name: file.name,
                    filename: encodeURIComponent(path.basename(file.path)),
                }

                if(file.filesize !== null) { encoded['filesize'] = file.filesize; }
                return encoded;
            });
        }

        return ApiUtil.deleteNullinHash(data);
    }

    /**
    * recorded のサムネイルパスを取得
    * @param recordedId: recorded id
    * @return Promise<string>
    */
    public async getThumbnailPath(recordedId: number): Promise<string> {
        let recorded = await this.recordedDB.findId(recordedId);

        if(recorded === null || recorded.thumbnailPath === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedThumbnailError);
        }

        return recorded.thumbnailPath;
    }

    /**
    * recorded の録画ファイルのパスを取得
    * @param recordedId: recorded id
    * @param encodedId: encoded id
    * @return Promise<string>
    */
    public async getFilePath(recordedId: number, encodedId: number | undefined): Promise<recordedFilePathInfo> {
        let isEncoded: boolean = typeof encodedId !== 'undefined';

        let result: DBSchema.RecordedSchema | DBSchema.EncodedSchema | null;
        result = isEncoded ? await this.encodedDB.findId(encodedId!) : await this.recordedDB.findId(recordedId);

        if(result === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let filePath: string | null = isEncoded ? (<DBSchema.EncodedSchema>result).path : (<DBSchema.RecordedSchema>result).recPath;
        if(filePath === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let mime: string;
        switch(path.extname(filePath)) {
            case '.mp4':
                mime = 'video/mp4';
                break;
            case '.webm':
                mime = 'video/webm';
                break;
            default:
                mime = 'video/mpeg';
                break;
        }

        return {
            mime: mime,
            path: filePath,
        }
    }

    /**
    * 録画を削除
    * @param recordedId: recorded id
    * @throws RecordedIsStreamingNow 指定した recordedId の録画が配信中
    * @return Promise<void>
    */
    public async deleteAllRecorded(recordedId: number): Promise<void> {
        this.streamManage.getStreamInfos().forEach((info) => {
            // 配信中か？
            if(typeof info.recordedId !== 'undefined' && info.recordedId === recordedId) {
                throw new Error(RecordedModelInterface.RecordedIsStreamingNowError);
            }
        });
        this.encodeManage.cancel(recordedId);
        await this.ipc.recordedDelete(recordedId);
    }

    /**
    * recorded のファイルを個別削除
    * @param recordedId: recorded id
    * @param encodedId: encoded id
    * @throws RecordedIsStreamingNow 指定した recordedId の録画が配信中
    * @throws NotFoundRecordedId 指定した recordedId の録画情報が無い
    * @throws NotFoundRecordedFileError ts ファイルがすでに削除されている
    * @throws DeleteFileError ファイル削除エラー
    * @throws FileIsLockedError エンコードに使用されている
    * @return Promise<void>
    */
    public async deleteRecorded(recordedId: number, encodedId: number | undefined): Promise<void> {
        this.streamManage.getStreamInfos().forEach((info) => {
            // 配信中か？
            if(typeof info.recordedId !== 'undefined' && info.recordedId === recordedId) {
                throw new Error(RecordedModelInterface.RecordedIsStreamingNowError);
            }
        });

        //recorded 情報の確認
        const recorded = await this.recordedDB.findId(recordedId);
        // 録画情報が無い
        if(recorded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedIdError); }

        // ファイルパス取得
        let filePath: string;
        if(typeof encodedId === 'undefined') {
            if(recorded.recPath === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = recorded.recPath!;
        } else {
            const encoded = await this.encodedDB.findId(encodedId);
            if(encoded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = encoded.path;
        }

        //エンコードのソースファイルか確認
        const info = this.encodeManage.getEncodingInfo();
        if(info.encoding !== null && info.encoding.source === filePath) {
            throw new Error(RecordedModelInterface.FileIsLockedError);
        }
        for(let q of info.queue) {
            if(q.source === filePath) { throw new Error(RecordedModelInterface.FileIsLockedError); }
        }

        // 削除
        if(typeof encodedId === 'undefined') {
            await this.ipc.recordedDeleteFile(recordedId);
        } else {
            await this.ipc.recordedDeleteEncodeFile(encodedId);
        }
    }

    /**
    * tag を取得
    * @return Promise<{}>
    */
    public async getGenreTags(): Promise<{}> {
        let rules = await this.rulesDB.findAllIdAndKeyword();
        let rulesIndex: { [key: number]: string } = {};
        for(let rule of rules) {
            rulesIndex[rule.id] = rule.keyword;
        }

        let ruleTag = (await this.recordedDB.getRuleTag()).map((rule) => {
            return {
                cnt: rule.cnt,
                ruleId: rule.ruleId,
                name: rule.ruleId === null || typeof rulesIndex[rule.ruleId] === 'undefined' ? 'キーワードなし' : rulesIndex[rule.ruleId],
            }
        });

        let services = await this.servicesDB.findAll();
        let servicesIndex: { [key: number]: string } = {};
        for(let service of services) {
            servicesIndex[service.id] = service.name;
        }

        let channelTag = (await this.recordedDB.getChannelTag()).map((channel) => {
            return {
                cnt: channel.cnt,
                channelId: channel.channelId,
                name: servicesIndex[channel.channelId],
            }
        });

        return {
            rule: ruleTag,
            channel: channelTag,
            genre: await this.recordedDB.getGenreTag(),
        };
    }

    /**
    * recorded の m3u8 ファイルを生成
    * @param host: host
    * @param isSecure: boolean true: https, false: http
    * @param recordedId: recorded id
    * @param encodedId: encoded id
    * @return Promise<PLayList>
    */
    public async getM3u8(host: string, isSecure: boolean, recordedId: number, encodedId: number | undefined): Promise<PLayList> {
        let recorded = await this.recordedDB.findId(recordedId);
        let encoded = typeof encodedId !== 'undefined' ? await this.encodedDB.findId(encodedId) : null;
        if(recorded === null || recorded.recPath === null && encoded === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let name = recorded.name;
        let duration = Math.floor(recorded.duration / 1000);
        let url = `${ isSecure ? 'https' : 'http' }://${ host }/api/recorded/${ recordedId }/file`;
        if(encoded !== null) { url += `?encodedId=${ encodedId }`; }

        let playList = '#EXTM3U\n'
        + `#EXTINF: ${ duration }, ${ name }\n`
        + url;

        let fileName = encoded === null ? path.basename(String(recorded.recPath)) : path.basename(encoded.path);
        return {
            name: encodeURIComponent(fileName + '.m3u8'),
            playList: playList,
        };
    }

    /**
    * kodi へ送信する
    * @param host: host
    * @param isSecure: boolean true: https, false: http
    * @param kodi: kodi index number
    * @param recordedId: recorded id
    * @param encodedId: encoded id
    * @return Promise<void>
    */
    public async sendToKodi(host: string, isSecure: boolean, kodi: number, recordedId: number, encodedId: number | undefined): Promise<void> {
        const kodiConfig = this.config.getConfig().kodiHosts;
        if(typeof kodiConfig === 'undefined' || typeof kodiConfig[kodi] === 'undefined') {
            throw new Error('KodiConfigIsNotFound');
        }

        let recorded = await this.recordedDB.findId(recordedId);
        let encoded = typeof encodedId !== 'undefined' ? await this.encodedDB.findId(encodedId) : null;
        if(recorded === null || recorded.recPath === null && encoded === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let source = `${ isSecure ? 'https' : 'http' }://${ host }/api/recorded/${ recordedId }/file`;
        if(encoded !== null) { source += `?encodedId=${ encodedId }`; }

        await ApiUtil.sendToKodi(source, kodiConfig[kodi].host, kodiConfig[kodi].user, kodiConfig[kodi].pass);
    }

    /**
    * encode 手動追加
    * @param recordedId: recorded id
    * @param option: EncodeAddOption
    * @throws EncodeModeIsNotFound 指定したエンコード設定がない場合
    * @throws NotFoundRecordedId 指定した recordedId の録画情報が無い
    * @throws IsRecording 指定した recordedId の録画が録画中
    * @throws NotFoundRecordedFileError ts ファイルがすでに削除されている
    * @return Promise<void>
    */
    public async addEncode(recordedId: number, option: EncodeAddOption): Promise<void> {
        // エンコード設定が存在するか確認
        const encodeConfig = this.config.getConfig().encode;
        if(typeof encodeConfig === 'undefined' || typeof encodeConfig[option.mode] === 'undefined') {
            throw new Error(RecordedModelInterface.EncodeModeIsNotFoundError);
        }

        //recorded 情報の確認
        const recorded = await this.recordedDB.findId(recordedId);
        // 録画情報が無い
        if(recorded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedIdError); }

        // 録画中か確認
        if(recorded.recording) { throw new Error(RecordedModelInterface.IsRecordingError); }

        // ファイルパス取得
        let filePath: string;
        if(typeof option.encodedId === 'undefined') {
            if(recorded.recPath === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = recorded.recPath;
        } else {
            const encoded = await this.encodedDB.findId(option.encodedId);
            if(encoded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = encoded.path;
        }

        // encode option 生成
        let encodeProgram: EncodeProgram = {
            recordedId: recorded.id,
            source: filePath,
            mode: option.mode,
            delTs: false,
            recordedProgram: recorded,
        }

        if(typeof option.isOutputTheOriginalDirectory !== 'undefined' && option.isOutputTheOriginalDirectory) {
            // 入力元と同じディレクトリに出力する
            encodeProgram.directory = path.dirname(filePath.slice(Util.getRecordedPath().length + path.sep.length));
        } else if(typeof option.directory !== 'undefined') {
            // ディレクトリ情報追加
            encodeProgram.directory = option.directory;
        }

        //エンコードを追加
        this.encodeManage.push(encodeProgram, typeof option.encodedId === 'undefined');
    }

    /**
    * エンコードキャンセル
    * @param recordedId
    */
    public async cancelEncode(recordedId: number): Promise<void> {
        await this.encodeManage.cancel(recordedId);
    }
}

export { RecordedModelInterface, RecordedModel }

