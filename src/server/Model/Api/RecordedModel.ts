import * as path from 'path';
import Util from '../../Util/Util';
import { VideoUtil } from '../../Util/VideoUtil';
import * as DBSchema from '../DB/DBSchema';
import { EncodedDBInterface } from '../DB/EncodedDB';
import { FindQuery, RecordedDBInterface } from '../DB/RecordedDB';
import { RulesDBInterface } from '../DB/RulesDB';
import { ServicesDBInterface } from '../DB/ServicesDB';
import { IPCClientInterface } from '../IPC/IPCClient';
import { ExternalFileInfo, NewRecorded } from '../Operator/Recorded/RecordedManageModel';
import { EncodeManageModelInterface, EncodeProgram } from '../Service/Encode/EncodeManageModel';
import { RecordedStreamStatusInfo, StreamManageModelInterface } from '../Service/Stream/StreamManageModel';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';
import { PlayList } from './PlayListInterface';

interface RecordedFilePathInfo {
    path: string;
    mime: string;
}

interface EncodingInfoIndex {
    [key: number]: {
        name: string;
        isEncoding: boolean;
    }[];
}

interface EncodeAddOption {
    mode: number;
    encodedId?: number;
    directory?: string;
    isOutputTheOriginalDirectory?: boolean;
}

interface RecordedModelInterface extends ApiModel {
    getAll(limit: number, offset: number, option?: FindQuery): Promise<{}[]>;
    getId(recordedId: number): Promise<{}>;
    getDuration(recordedId: number): Promise<number | null>;
    getThumbnailPath(recordedId: number): Promise<string>;
    getFilePath(recordedId: number, encodedId: number | undefined): Promise<RecordedFilePathInfo>;
    deleteAllRecorded(recordedId: number): Promise<void>;
    deleteRecordeds(recordedIds: number[]): Promise<number[]>;
    deleteRecorded(recordedId: number, encodedId: number | undefined): Promise<void>;
    getGenreTags(): Promise<{}>;
    getM3u8(host: string, isSecure: boolean, recordedId: number, encodedId: number | undefined): Promise<PlayList>;
    sendToKodi(host: string, isSecure: boolean, kodi: number, recordedId: number, encodedId: number | undefined): Promise<void>;
    addExternalFile(info: ExternalFileInfo): Promise<void>;
    createNewRecorded(info: NewRecorded): Promise<{ id: number }>;
    addEncode(recordedId: number, option: EncodeAddOption): Promise<void>;
    cancelEncode(recordedId: number): Promise<void>;
}

namespace RecordedModelInterface {
    export const NotFoundRecordedIdError = 'NotFoundRecordedId';
    export const NotFoundRecordedThumbnailError = 'NotFoundRecordedThumbnail';
    export const NotFoundRecordedFileError = 'NotFoundRecordedFile';
    export const RecordedIsStreamingNowError = 'RecordedIsStreamingNow';
    export const DeleteFileError = 'DeleteFileError';
    export const FileIsLockedError = 'FileIsLocked';
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
    public async getAll(limit: number, offset: number, query: FindQuery = {}): Promise<any> {
        const datas = await this.recordedDB.findAll({
            limit: limit,
            offset: offset,
            query: query,
        });
        const total = await this.recordedDB.getTotal(query);
        const infoIndex = await this.getEncodingInfoIndex();

        const results: any[] = [];
        for (let i = 0; i < datas.length; i++) {
            const encodedFiles = await this.encodedDB.findRecordedId(datas[i].id);
            const encodingInfo = infoIndex[datas[i].id];
            if (typeof encodingInfo !== 'undefined') { datas[i]['encoding'] = encodingInfo; }
            results.push(this.fixResult(datas[i], encodedFiles));
        }

        return {
            recorded: results,
            total: total,
        };
    }

    /**
     * encodingInfo を取得
     * @return Promise<EncodingInfoIndex>
     */
    private async getEncodingInfoIndex(): Promise<EncodingInfoIndex> {
        const encodingInfo = await this.encodeManage.getEncodingInfo();

        const encoding: EncodingInfoIndex = {};

        const config = this.config.getConfig().encode;
        if (typeof config !== 'undefined') {
            // エンコード中
            if (encodingInfo.encoding !== null) {
                if (typeof encoding[encodingInfo.encoding.recordedId] === 'undefined') {
                    encoding[encodingInfo.encoding.recordedId] = [];
                }

                encoding[encodingInfo.encoding.recordedId].push({
                    name: encodingInfo.encoding.name,
                    isEncoding: true,
                });
            }

            // エンコード待機中
            for (const program of encodingInfo.queue) {
                if (typeof encoding[program.recordedId] === 'undefined') {
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
        const recorded = await this.recordedDB.findId(recordedId);
        const infoIndex = await this.getEncodingInfoIndex();

        if (recorded === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedIdError);
        }

        const encodedFiles = await this.encodedDB.findRecordedId(recordedId);

        const encodingInfo = infoIndex[recordedId];
        if (typeof encodingInfo !== 'undefined') { recorded['encoding'] = encodingInfo; }

        return this.fixResult(recorded, encodedFiles);
    }

    /**
     * 動画の実際の長さを取得する
     * @param recordedId: recorded id
     * @return Promise<number>
     */
    public async getDuration(recordedId: number): Promise<number | null> {
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null || recorded.recPath === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedIdError);
        }

        const info = await VideoUtil.getVideoInfo(recorded.recPath);

        return Math.floor(info.duration);
    }

    /**
     * DBSchema.RecordedSchema の boolean 値を number から boolean へ正す
     * @param data: DBSchema.RecordedSchema
     * @return {};
     */
    private fixResult(data: {}, encodedFiles: DBSchema.EncodedSchema[]): {} {
        delete data['duration'];

        // thumbnaul があるか
        data['hasThumbnail'] = data['thumbnailPath'] !== null;
        delete data['thumbnailPath'];

        data['recording'] = data['recording'];

        data['original'] = data['recPath'] !== null;

        if (data['recPath'] !== null) {
            data['filename'] = encodeURIComponent(path.basename(String(data['recPath'])));
        }
        delete data['recPath'];

        // エンコードファイルを追加
        if (encodedFiles.length > 0) {
            data['encoded'] = encodedFiles.map((file) => {
                const encoded = {
                    encodedId: file.id,
                    name: file.name,
                    filename: encodeURIComponent(path.basename(file.path)),
                };

                if (file.filesize !== null) { encoded['filesize'] = file.filesize; }

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
        const recorded = await this.recordedDB.findId(recordedId);

        if (recorded === null || recorded.thumbnailPath === null) {
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
    public async getFilePath(recordedId: number, encodedId: number | undefined): Promise<RecordedFilePathInfo> {
        const isEncoded: boolean = typeof encodedId !== 'undefined';

        let result: DBSchema.RecordedSchema | DBSchema.EncodedSchema | null;
        result = isEncoded ? await this.encodedDB.findId(encodedId!) : await this.recordedDB.findId(recordedId);

        if (result === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        const filePath: string | null = isEncoded ? (<DBSchema.EncodedSchema> result).path : (<DBSchema.RecordedSchema> result).recPath;
        if (filePath === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let mime: string;
        switch (path.extname(filePath)) {
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
        };
    }

    /**
     * 録画を削除
     * @param recordedId: recorded id
     * @throws RecordedIsStreamingNow 指定した recordedId の録画が配信中
     * @return Promise<void>
     */
    public async deleteAllRecorded(recordedId: number): Promise<void> {
        const infos = this.streamManage.getStreamInfos();
        for (const info of infos) {
            // 配信中か？
            if (typeof (<RecordedStreamStatusInfo> info).recordedId !== 'undefined' && (<RecordedStreamStatusInfo> info).recordedId === recordedId) {
                throw new Error(RecordedModelInterface.RecordedIsStreamingNowError);
            }
        }

        this.encodeManage.cancel(recordedId);
        await this.ipc.recordedDelete(recordedId);
    }

    /**
     * 録画を複数削除
     * @param recordedIds: recorded ids
     * @return Promise<number[]> 削除できなかった recorded ids を返す
     */
    public async deleteRecordeds(recordedIds: number[]): Promise<number[]> {
        // 配信中の録画の recordedId の索引を作成
        const infos = this.streamManage.getStreamInfos();
        const recordedStreamIndex: { [key: number]: boolean } = {};
        for (const info of infos) {
            if (typeof (<RecordedStreamStatusInfo> info).recordedId !== 'undefined') {
                recordedStreamIndex[(<RecordedStreamStatusInfo> info).recordedId!] = true;
            }
        }

        // 配信中の要素を取り除く
        const ids: number[] = [];
        const excludedIds: number[] = [];
        for (const recordedId of recordedIds) {
            // 配信中か？
            if (typeof recordedStreamIndex[recordedId] === 'undefined') {
                ids.push(recordedId);
            } else {
                excludedIds.push(recordedId);
            }
        }

        // 削除
        const errors = await this.ipc.recordedDeletes(ids);

        // 削除できなかった ids と配信中で取り除かれた要素を結合
        Array.prototype.push.apply(excludedIds, errors);

        return excludedIds;
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
        this.streamManage.getStreamInfos().forEach((data) => {
            // 配信中か？
            if (typeof (<RecordedStreamStatusInfo> data).recordedId !== 'undefined' && (<RecordedStreamStatusInfo> data).recordedId === recordedId) {
                throw new Error(RecordedModelInterface.RecordedIsStreamingNowError);
            }
        });

        // recorded 情報の確認
        const recorded = await this.recordedDB.findId(recordedId);
        // 録画情報が無い
        if (recorded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedIdError); }

        // ファイルパス取得
        let filePath: string;
        if (typeof encodedId === 'undefined') {
            if (recorded.recPath === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = recorded.recPath!;
        } else {
            const encoded = await this.encodedDB.findId(encodedId);
            if (encoded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = encoded.path;
        }

        // エンコードのソースファイルか確認
        const info = this.encodeManage.getEncodingInfo();
        if (info.encoding !== null && info.encoding.source === filePath) {
            throw new Error(RecordedModelInterface.FileIsLockedError);
        }
        for (const q of info.queue) {
            if (q.source === filePath) { throw new Error(RecordedModelInterface.FileIsLockedError); }
        }

        // 削除
        if (typeof encodedId === 'undefined') {
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
        const rules = await this.rulesDB.findAllIdAndKeyword();
        const rulesIndex: { [key: number]: string } = {};
        for (const rule of rules) {
            rulesIndex[rule.id] = rule.keyword;
        }

        const ruleTag = (await this.recordedDB.getRuleTag()).map((rule) => {
            return {
                cnt: rule.cnt,
                ruleId: rule.ruleId,
                name: rule.ruleId === null || typeof rulesIndex[rule.ruleId] === 'undefined' ? 'キーワードなし' : rulesIndex[rule.ruleId],
            };
        });

        const services = await this.servicesDB.findAll();
        const servicesIndex: { [key: number]: string } = {};
        for (const service of services) {
            servicesIndex[service.id] = service.name;
        }

        const channelTag = (await this.recordedDB.getChannelTag()).map((channel) => {
            return {
                cnt: channel.cnt,
                channelId: channel.channelId,
                name: servicesIndex[channel.channelId],
            };
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
     * @return Promise<PlayList>
     */
    public async getM3u8(host: string, isSecure: boolean, recordedId: number, encodedId: number | undefined): Promise<PlayList> {
        const recorded = await this.recordedDB.findId(recordedId);
        const encoded = typeof encodedId !== 'undefined' ? await this.encodedDB.findId(encodedId) : null;
        if (recorded === null || recorded.recPath === null && encoded === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        let baseUrl = `/api/recorded/${ recordedId }/file`;
        if (encoded !== null) { baseUrl += `?encodedId=${ encodedId }`; }

        const fileName = encoded === null ? path.basename(String(recorded.recPath)) : path.basename(encoded.path);

        return {
            name: encodeURIComponent(fileName + '.m3u8'),
            playList: ApiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: recorded.name,
                duration: Math.floor(recorded.duration / 1000),
                baseUrl: baseUrl,
                basicAuth: this.config.getConfig().basicAuth,
            }),
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
        host = ApiUtil.getHost(host);
        const kodiConfig = this.config.getConfig().kodiHosts;
        if (typeof kodiConfig === 'undefined' || typeof kodiConfig[kodi] === 'undefined') {
            throw new Error('KodiConfigIsNotFound');
        }

        const recorded = await this.recordedDB.findId(recordedId);
        const encoded = typeof encodedId !== 'undefined' ? await this.encodedDB.findId(encodedId) : null;
        if (recorded === null || recorded.recPath === null && encoded === null) {
            throw new Error(RecordedModelInterface.NotFoundRecordedFileError);
        }

        const basicAuth = this.config.getConfig().basicAuth;
        const auth = typeof basicAuth === 'undefined' ? '' : `${ basicAuth.user }:${ basicAuth.password }@`;
        let source = `${ isSecure ? 'https' : 'http' }://${ auth }${ host }/api/recorded/${ recordedId }/file`;
        if (encoded !== null) { source += `?encodedId=${ encodedId }`; }

        await ApiUtil.sendToKodi(source, kodiConfig[kodi].host, kodiConfig[kodi].user, kodiConfig[kodi].pass);
    }

    /**
     * upload された動画ファイルを追加する
     * @param info: ExternalFileInfo
     * @return Promise<void>
     */
    public async addExternalFile(info: ExternalFileInfo): Promise<void> {
        await this.ipc.addRecordedExternalFile(info);
    }

    /**
     * 録画新規作成
     * @param info: NewRecorded
     * @return Promise<{ id: number }> recordedId
     */
    public async createNewRecorded(info: NewRecorded): Promise<{ id: number }> {
        const recordedId = await this.ipc.createNewRecorded(info);

        return { id: recordedId };
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
        if (typeof encodeConfig === 'undefined' || typeof encodeConfig[option.mode] === 'undefined') {
            throw new Error(RecordedModelInterface.EncodeModeIsNotFoundError);
        }

        // recorded 情報の確認
        const recorded = await this.recordedDB.findId(recordedId);
        // 録画情報が無い
        if (recorded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedIdError); }

        // 録画中か確認
        if (recorded.recording) { throw new Error(RecordedModelInterface.IsRecordingError); }

        // ファイルパス取得
        let filePath: string;
        if (typeof option.encodedId === 'undefined') {
            if (recorded.recPath === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = recorded.recPath;
        } else {
            const encoded = await this.encodedDB.findId(option.encodedId);
            if (encoded === null) { throw new Error(RecordedModelInterface.NotFoundRecordedFileError); }
            filePath = encoded.path;
        }

        // encode option 生成
        const encodeProgram: EncodeProgram = {
            recordedId: recorded.id,
            source: filePath,
            mode: option.mode,
            delTs: false,
            recordedProgram: recorded,
        };
        if (typeof option.encodedId !== 'undefined') {
            encodeProgram.encodedId = option.encodedId;
        }

        if (typeof option.isOutputTheOriginalDirectory !== 'undefined' && option.isOutputTheOriginalDirectory) {
            // 入力元と同じディレクトリに出力する
            const recordedDir = Util.getRecordedPath();
            const directory = path.dirname(filePath.slice(Util.getRecordedPath().length + path.sep.length));

            if (path.normalize(recordedDir) !== path.normalize(path.join(recordedDir, directory))) {
                encodeProgram.directory = directory;
            }
        } else if (typeof option.directory !== 'undefined') {
            // ディレクトリ情報追加
            encodeProgram.directory = option.directory;
        }

        // エンコードを追加
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

export { RecordedModelInterface, RecordedModel };

