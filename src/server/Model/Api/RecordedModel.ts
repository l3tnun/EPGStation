import * as path from 'path';
import ApiModel from './ApiModel';
import { IPCClientInterface } from '../IPC/IPCClient';
import { findQuery, RecordedDBInterface } from '../DB/RecordedDB';
import { EncodedDBInterface } from '../DB/EncodedDB';
import { RulesDBInterface } from '../DB/RulesDB';
import { ServicesDBInterface } from '../DB/ServicesDB';
import * as DBSchema from '../DB/DBSchema';
import ApiUtil from './ApiUtil';
import { EncodeManagerInterface } from '../../Service/EncodeManager';
import { PLayList } from './PlayListInterface';

interface recordedFilePathInfo {
    path: string,
    mime: string,
}

type encodingInfoIndex = { [key: number]: { name: string, isEncoding: boolean }[] }

interface RecordedModelInterface extends ApiModel {
    getAll(limit: number, offset: number, option?: findQuery): Promise<{}[]>
    getId(recordedId: number): Promise<{}>;
    getThumbnailPath(recordedId: number): Promise<string>;
    getFilePath(recordedId: number, encodedId: number | undefined): Promise<recordedFilePathInfo>;
    deleteRecorded(recordedId: number): Promise<void>
    getGenreTags(): Promise<{}>;
    getM3u8(host: string, isSecure: boolean, recordedId: number, encodedId: number | undefined): Promise<PLayList>;
}

namespace RecordedModelInterface {
    export const NotFoundRecordedIdError = 'NotFoundRecordedId'
    export const NotFoundRecordedThumbnailError = 'NotFoundRecordedThumbnail'
    export const NotFoundRecordedFileError = 'NotFoundRecordedFile'
}

class RecordedModel extends ApiModel implements RecordedModelInterface {
    private ipc: IPCClientInterface;
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;
    private rulesDB: RulesDBInterface;
    private servicesDB: ServicesDBInterface;
    private encodeManager: EncodeManagerInterface;

    constructor(
        ipc: IPCClientInterface,
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
        rulesDB: RulesDBInterface,
        servicesDB: ServicesDBInterface,
        encodeManager: EncodeManagerInterface,
    ) {
        super();
        this.ipc = ipc;
        this.recordedDB = recordedDB;
        this.encodedDB = encodedDB;
        this.rulesDB = rulesDB;
        this.servicesDB = servicesDB;
        this.encodeManager = encodeManager;
    }

    /**
    * recorded をすべて取得
    * @param limit: number | undefined
    * @param offset: number
    * @return Promise<any>
    */
    public async getAll(limit: number, offset: number, option: findQuery = {}): Promise<any> {
        let datas = await this.recordedDB.findAll(limit, offset, option);
        let total = await this.recordedDB.getTotal(option);
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
        let encodingInfo = await this.encodeManager.getEncodingInfo();

        let encoding: encodingInfoIndex = {};

        let config = this.config.getConfig().encode;
        if(typeof config !== 'undefined') {
            //エンコード中
            if(encodingInfo.encoding !== null) {
                if(typeof encoding[encodingInfo.encoding.recordedId] === 'undefined') {
                    encoding[encodingInfo.encoding.recordedId] = [];
                }

                let name = typeof config[encodingInfo.encoding.mode] === 'undefined' ? 'undefined' : config[encodingInfo.encoding.mode].name;
                encoding[encodingInfo.encoding.recordedId].push({
                    name: name,
                    isEncoding: true,
                });
            }

            //エンコード待機中
            for(let program of encodingInfo.queue) {
                if(typeof encoding[program.recordedId] === 'undefined') {
                    encoding[program.recordedId] = [];
                }

                let name = typeof config[program.mode] === 'undefined' ? 'undefined' : config[program.mode].name;
                encoding[program.recordedId].push({
                    name: name,
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
        let result = await this.recordedDB.findId(recordedId);
        let infoIndex = await this.getEncodingInfoIndex();

        if(result.length === 0) {
            throw new Error(RecordedModelInterface.NotFoundRecordedIdError);
        }

        let encodedFiles = await this.encodedDB.findRecordedId(recordedId);

        let encodingInfo = infoIndex[recordedId];
        if(typeof encodingInfo !== 'undefined') { result[0]['encoding'] = encodingInfo; }
        return this.fixResult(result[0], encodedFiles);
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

        data['recording'] = Boolean(data['recording']);

        data['original'] = data['recPath'] !== null

        data['filename'] = encodeURIComponent(path.basename(String(data['recPath'])));
        delete data['recPath'];

        // エンコードファイルを追加
        if(encodedFiles.length > 0) {
            data['encoded'] = encodedFiles.map((file) => {
                return {
                    encodedId: file.id,
                    name: file.name,
                    filename: encodeURIComponent(path.basename(String(file.path))),
                }
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
        let result = await this.recordedDB.findId(recordedId);

        if(result.length === 0 || result[0].thumbnailPath === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedThumbnailError);
        }

        return result[0].thumbnailPath!;
    }

    /**
    * recorded の録画ファイルのパスを取得
    * @param recordedId: recorded id
    * @param encodedId: encoded id
    * @return Promise<string>
    */
    public async getFilePath(recordedId: number, encodedId: number | undefined): Promise<recordedFilePathInfo> {
        let isEncoded: boolean = typeof encodedId !== 'undefined';

        let result: DBSchema.RecordedSchema[] | DBSchema.EncodedSchema[];
        result = isEncoded ? await this.encodedDB.findId(encodedId!) : await this.recordedDB.findId(recordedId);

        if(result.length === 0) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let filePath: string | null = isEncoded ? (<DBSchema.EncodedSchema[]>result)[0].path : (<DBSchema.RecordedSchema[]>result)[0].recPath;
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
    * @return Promise<void>
    */
    public async deleteRecorded(recordedId: number): Promise<void> {
        this.encodeManager.cancel(recordedId);
        await this.ipc.recordedDelete(recordedId);
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
        if(recorded.length === 0 || recorded[0].recPath === null && encoded === null || encoded !== null && encoded.length === 0) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let name = recorded[0].name;
        let duration = Math.floor(recorded[0].duration / 1000);
        let url = `${ isSecure ? 'https' : 'http' }://${ host }/api/recorded/${ recordedId }/file`;
        if(encoded !== null) { url += `?encodedId=${ encodedId }`; }

        let playList = '#EXTM3U\n'
        + `#EXTINF: ${ duration }, ${ name }\n`
        + url;

        let fileName = encoded === null ? path.basename(String(recorded[0].recPath)) : path.basename(String(encoded[0].path));
        return {
            name: encodeURIComponent(fileName + '.m3u8'),
            playList: playList,
        };
    }
}

export { RecordedModelInterface, RecordedModel }

