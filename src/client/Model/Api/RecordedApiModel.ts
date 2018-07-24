import * as m from 'mithril';
import * as apid from '../../../../api';
import ApiModel from './ApiModel';

interface FindQueryOption {
    rule?: number;
    genre1?: number;
    channel?: number;
    keyword?: string;
}

interface EncodeQueryOption {
    mode: number;
    encodedId?: number;
    directory?: string;
    isOutputTheOriginalDirectory?: boolean;
}

interface UploadQueryOption {
    id: number;
    directory?: string;
    encoded: boolean;
    name: string;
    file: File;
}

interface RecordedApiModelInterface extends ApiModel {
    init(): void;
    update(): Promise<void>;
    fetchRecordeds(limit: number, offset: number, option: FindQueryOption): Promise<void>;
    fetchRecorded(recordedId: apid.RecordedId): Promise<void>;
    fetchDuration(recordedId: apid.RecordedId): Promise<void>;
    fetchTags(): Promise<void>;
    fetchLog(recordedId: apid.RecordedId): Promise<void>;
    createNewRecord(recorded: apid.NewRecorded): Promise<number>;
    uploadFile(query: UploadQueryOption): Promise<void>;
    abortUpload(): void;
    deleteAll(recordedId: apid.RecordedId): Promise<void>;
    delete(recordedId: apid.RecordedId, encodedId: apid.EncodedId | null): Promise<void>;
    deleteMultiple(recordedIds: apid.RecordedId[]): Promise<void>;
    sendToKodi(kodi: number, recordedId: number, encodedId: number | null): Promise<void>;
    getRecordeds(): apid.RecordedPrograms;
    getRecorded(): apid.RecordedProgram | null;
    getDuration(): number;
    getPage(): number;
    getTags(): apid.RecordedTags;
    getLog(): string | null;
    addEncode(recordedId: apid.RecordedId, option: EncodeQueryOption): Promise<void>;
    cancelEncode(recordedId: apid.RecordedId): Promise<void>;
    cleanup(): Promise<void>;
}

namespace RecordedApiModelInterface {
    export const isStreamingNowError = 'isStreamingNow';
    export const isLockedError = 'isLocked';
}

/**
 * RecordedApiModel
 * /api/recorded
 */
class RecordedApiModel extends ApiModel implements RecordedApiModelInterface {
    private recordeds: apid.RecordedPrograms = { recorded: [], total: 0 };
    private recorded: apid.RecordedProgram | null = null;
    private duration: number = 0;
    private tags: apid.RecordedTags = {
        rule: [],
        channel: [],
        genre: [],
    };
    private uploadXHR: XMLHttpRequest | null = null;
    private errorLogStr: string | null = null;
    private limit: number = 0;
    private offset: number = 0;
    private option: FindQueryOption = {};
    private currentPage: number = 1;

    public init(): void {
        super.init();
        this.recordeds = {
            recorded: [],
            total: 0,
        };
        this.recorded = null;
        this.duration = 0;
        this.uploadXHR = null;
        this.errorLogStr = null;
    }

    /**
     * query を現在の状況のまま更新する
     */
    public async update(): Promise<void> {
        return this.fetchRecordeds(this.limit, this.offset, this.option);
    }

    /**
     * 録画一覧を取得
     * /api/recorded
     * @param limit: limit
     * @param offset: offset
     */
    public async fetchRecordeds(limit: number, offset: number, option: FindQueryOption): Promise<void> {
        this.limit = limit;
        this.offset = offset;
        this.option = option;

        const query: { [key: string]: number | string } = {
            limit: limit,
            offset: offset,
        };

        if (typeof option.rule !== 'undefined') { query.rule = option.rule; }
        if (typeof option.genre1 !== 'undefined') { query.genre1 = option.genre1; }
        if (typeof option.channel !== 'undefined') { query.channel = option.channel; }
        if (typeof option.keyword !== 'undefined') { query.keyword = option.keyword; }

        try {
            this.recordeds = await <any> this.request({
                method: 'GET',
                url: './api/recorded',
                data: query,
            });

            this.currentPage = this.offset / this.limit + 1;
        } catch (err) {
            this.recordeds = { recorded: [], total: 0 };
            console.error('./api/recorded');
            console.error(err);
            this.openSnackbar('録画情報取得に失敗しました');
        }
    }

    /**
     * 録画情報を取得
     * @param recordedId: recorded id
     */
    public async fetchRecorded(recordedId: apid.RecordedId): Promise<void> {
        try {
            this.recorded = await <any> this.request({
                method: 'GET',
                url: `./api/recorded/${ recordedId }`,
            });
        } catch (err) {
            this.recorded = null;
            console.error(`./api/recorded/${ recordedId }`);
            console.error(err);
            this.openSnackbar('録画情報取得に失敗しました');
        }
    }

    /**
     * 動画の長さを取得
     */
    public async fetchDuration(recordedId: apid.RecordedId): Promise<void> {
        try {
            const result = await <any> this.request({
                method: 'GET',
                url: `./api/recorded/${ recordedId }/duration`,
            });

            this.duration = result.duration;
        } catch (err) {
            console.error(`./api/recorded/${ recordedId}/duration`);
            console.error(err);
            this.openSnackbar('動画の長さ取得に失敗しました');
        }
    }

    /**
     * 録画タグを取得
     * /api/recorded/tags
     */
    public async fetchTags(): Promise<void> {
        try {
            this.tags = await <any> this.request({
                method: 'GET',
                url: './api/recorded/tags',
            });
        } catch (err) {
            this.tags = {
                rule: [],
                channel: [],
                genre: [],
            };
            console.error('./api/recorded/tags');
            console.error(err);
            this.openSnackbar('録画タグ情報取得に失敗しました');
        }
    }

    /**
     * log ファイル取得
     * /api/recorded/{ id }/log
     */
    public async fetchLog(recordedId: apid.RecordedId): Promise<void> {
        try {
            this.errorLogStr = await <any> this.request({
                method: 'GET',
                url: `./api/recorded/${ recordedId }/log`,
                deserialize: (str) => { return str; },
            });
        } catch (err) {
            this.errorLogStr = null;
            console.error(`./api/recorded/${ recordedId}/log`);
            console.error(err);
            this.openSnackbar('log 取得に失敗しました。');
        }
    }

    /**
     * 新しい recorded の作成
     * /api/recorded post
     * @param recorded: apid.NewRecorded
     * @return Promise<number> recorded id
     */
    public async createNewRecord(recorded: apid.NewRecorded): Promise<number> {
        const result = <{ id: number }> await this.request({
            method: 'POST',
            url: './api/recorded',
            data: recorded,
        });

        return result.id;
    }

    /**
     * file の upload
     * /api/recorded/{id}/upload
     * @param query: UploadQueryOption
     * @return Promise<void>
     */
    public async uploadFile(query: UploadQueryOption): Promise<void> {
        const data = new FormData();
        for (const key in query) {
            if (key === 'id') { continue; }
            data.append(key, query[key]);
        }

        try {
            // this.request だと abort 後動かなくなる
            await m.request({
                method: 'POST',
                url: `./api/recorded/${ query.id }/upload`,
                data: data,
                config: (xhr: XMLHttpRequest) => { this.uploadXHR = xhr; },
            });
            this.uploadXHR = null;
        } catch (err) {
            this.uploadXHR = null;
            throw err;
        }
    }

    /**
     * upload のキャンセル
     */
    public abortUpload(): void {
        if (this.uploadXHR === null) { return; }

        this.uploadXHR.abort();
        this.uploadXHR = null;
    }

    /**
     * 録画の削除
     * /api/recorded/{id} delete
     * @param recordedId: recorded id
     * @return Promise<void>
     * @throws isStreamingNow: 配信中の場合発生
     */
    public async deleteAll(recordedId: apid.RecordedId): Promise<void> {
        await this.request({
            method: 'DELETE',
            url: `./api/recorded/${ recordedId }`,
            extract: (xhr) => {
                if (xhr.status === 409) { throw new Error(RecordedApiModelInterface.isStreamingNowError); }

                return xhr.responseText;
            },
        });
    }

    /**
     * 録画の個別削除
     * /api/recorded/{id}/file delete
     * @param recordedId: recorded id
     * @param encodedId: encoded id
     * @return Promise<void>
     * @throws isLocked: ファイルが使用されている
     */
    public async delete(recordedId: apid.RecordedId, encodedId: apid.EncodedId | null): Promise<void> {
        const query = encodedId === null ? '' : `?encodedId=${ encodedId }`;

        await this.request({
            method: 'DELETE',
            url: `./api/recorded/${ recordedId }/file${ query }`,
            extract: (xhr) => {
                if (xhr.status === 423) { throw new Error(RecordedApiModelInterface.isLockedError); }

                return xhr.responseText;
            },
        });
    }

    /**
     * 複数録画削除
     * /api/recorded/delete post
     * @param recordedIds: recorded ids
     * @throws DeleteMultipleError 一部削除に失敗した場合
     */
    public async deleteMultiple(recordedIds: apid.RecordedId[]): Promise<void> {
        const option = {
            recordedIds: recordedIds,
        };

        const result = <apid.RecordedDeleteMultipleResult> await this.request({
            method: 'POST',
            url: './api/recorded/delete',
            data: option,
        });

        if (result.results.length > 0) {
            throw new Error('DeleteMultipleError');
        }
    }

    /**
     * kodi へ配信
     * /api/recorded/{id}/kodi
     * @param kodi: kodi hosts index number
     * @param recordedId: recordedId
     * @param encodedId: encodedId
     */
    public async sendToKodi(kodi: number, recordedId: number, encodedId: number | null = null): Promise<void> {
        const query: { [key: string ]: number } = {
            kodi: kodi,
            recordedId: recordedId,
        };

        if (encodedId !== null) {
            query.encodedId = encodedId;
        }

        try {
            await this.request({
                method: 'POST',
                url: `./api/recorded/${ recordedId }/kodi`,
                data: query,
            });

            this.openSnackbar('kodi へ送信しました');
        } catch (err) {
            console.error(`./api/recorded/${ recordedId }/kodi POST`);
            console.error(err);
            this.openSnackbar('kodi への送信に失敗しました');
        }
    }

    /**
     * recordeds の取得
     * @return apid.RecordedPrograms
     */
    public getRecordeds(): apid.RecordedPrograms {
        return this.recordeds;
    }

    /**
     * recorded の取得
     * @return apid.RecordedProgram | null;
     */
    public getRecorded(): apid.RecordedProgram | null {
        return this.recorded;
    }

    /**
     * duration の取得
     * @return number
     */
    public getDuration(): number {
        return this.duration;
    }

    /**
     * 現在のページを取得
     * @return number
     */
    public getPage(): number {
        return this.currentPage;
    }

    /**
     * tags の取得
     * @return RecordedTags
     */
    public getTags(): apid.RecordedTags {
        return this.tags;
    }

    /**
     * error log の取得
     * @return string | null
     */
    public getLog(): string | null {
        return this.errorLogStr;
    }

    /**
     * エンコード追加
     * /api/recorded/{id}/encode post
     * @param recordedId: recorded id
     * @param option: EncodeQueryOption
     * @return Promise<void>
     */
    public async addEncode(recordedId: apid.RecordedId, option: EncodeQueryOption): Promise<void> {
        await this.request({
            method: 'POST',
            url: `./api/recorded/${ recordedId }/encode`,
            data: option,
        });
    }

    /**
     * エンコードキャンセル
     * /api/recorded/{id}/encode delete
     * @param recordedId: recorded id
     */
    public async cancelEncode(recordedId: apid.RecordedId): Promise<void> {
        await this.request({
            method: 'DELETE',
            url: `./api/recorded/${ recordedId }/encode`,
        });
    }

    /**
     * 録画の cleanup
     * /api/recorded/cleanup
     */
    public async cleanup(): Promise<void> {
        await this.request({
            method: 'POST',
            url: './api/recorded/cleanup',
        });
    }
}

export { FindQueryOption, EncodeQueryOption, UploadQueryOption, RecordedApiModelInterface, RecordedApiModel };

