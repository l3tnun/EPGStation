import * as m from 'mithril';
import ApiModel from './ApiModel';
import * as apid from '../../../../api';

interface findQuery {
    rule?: number,
    genre1?: number,
    channel?: number,
    keyword?: string,
}

interface RecordedApiModelInterface extends ApiModel {
    init(): void;
    update(): Promise<void>;
    fetchRecorded(limit: number, offset: number, option: findQuery): Promise<void>;
    fetchTags(): Promise<void>;
    deleteAll(recordedId: apid.RecordedId): Promise<void>;
    delete(recordedId: apid.RecordedId, encodedId: apid.EncodedId | null): Promise<void>;
    sendToKodi(kodi: number, recordedId: number, encodedId: number | null): Promise<void>;
    getRecorded(): apid.RecordedPrograms;
    getTags(): apid.RecordedTags;
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
    private recorded: apid.RecordedPrograms;
    private tags: apid.RecordedTags = {
        rule: [],
        channel: [],
        genre: [],
    };
    private limit: number;
    private offset: number;
    private option: findQuery = {}

    public init(): void {
        super.init();
        this.recorded = {
            recorded: [],
            total: 0,
        };
    }

    /**
    * query を現在の状況のまま更新する
    */
    public async update(): Promise<void> {
        return this.fetchRecorded(this.limit, this.offset, this.option);
    }

    /**
    * 録画一覧を取得
    * /api/recorded
    * @param limit: limit
    * @param offset: offset
    */
    public async fetchRecorded(limit: number, offset: number, option: findQuery): Promise<void> {
        this.limit = limit;
        this.offset = offset;
        this.option = option;

        let query: { [key: string]: number | string } = {
            limit: limit,
            offset: offset,
        };

        if(typeof option.rule !== 'undefined') { query.rule = option.rule; }
        if(typeof option.genre1 !== 'undefined') { query.genre1 = option.genre1; }
        if(typeof option.channel !== 'undefined') { query.channel = option.channel; }
        if(typeof option.keyword !== 'undefined') { query.keyword = option.keyword; }

        try {
            this.recorded = await <any> m.request({
                method: 'GET',
                url: '/api/recorded',
                data: query,
            });
        } catch(err) {
            this.recorded = { recorded: [], total: 0 };
            console.error('/api/recorded');
            console.error(err);
            this.openSnackbar('録画情報取得に失敗しました');
        }
    }

    /**
    * 録画タグを取得
    * /api/recorded/tags
    */
    public async fetchTags(): Promise<void> {
        try {
            this.tags = await <any> m.request({
                method: 'GET',
                url: '/api/recorded/tags',
            });
        } catch(err) {
            this.tags = {
                rule: [],
                channel: [],
                genre: [],
            };
            console.error('/api/recorded/tags');
            console.error(err);
            this.openSnackbar('録画タグ情報取得に失敗しました');
        }
    }

    /**
    * 録画の削除
    * /api/recorded/{id} delete
    * @param recordedId: recorded id
    * @return Promise<void>
    * @throws isStreamingNow: 配信中の場合発生
    */
    public async deleteAll(recordedId: apid.RecordedId): Promise<void> {
        await m.request({
            method: 'DELETE',
            url: `/api/recorded/${ recordedId }`,
            extract: (xhr) => {
                if(xhr.status === 409) { throw new Error(RecordedApiModelInterface.isStreamingNowError); }
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

        await m.request({
            method: 'DELETE',
            url: `/api/recorded/${ recordedId }/file${ query }`,
            extract: (xhr) => {
                if(xhr.status === 423) { throw new Error(RecordedApiModelInterface.isLockedError); }
                return xhr.responseText;
            },
        });
    }

    /**
    * kodi へ配信
    * /api/recorded/{id}/kodi
    * @param kodi: kodi hosts index number
    * @param recordedId: recordedId
    * @param encodedId: encodedId
    */
    public async sendToKodi(kodi: number, recordedId: number, encodedId: number | null = null): Promise<void> {
        let query: { [key: string ]: number } = {
            kodi: kodi,
            recordedId: recordedId,
        };

        if(encodedId !== null) {
            query.encodedId = encodedId;
        }

        try {
            await m.request({
                method: 'POST',
                url: `/api/recorded/${ recordedId }/kodi`,
                data: query,
            });

            this.openSnackbar('kodi へ送信しました');
        } catch(err) {
            console.error(`/api/recorded/${ recordedId }/kodi POST`);
            console.error(err);
            this.openSnackbar('kodi への送信に失敗しました');
        }
    }

    /**
    * recorded の取得
    * @return apid.RecordedPrograms
    */
    public getRecorded(): apid.RecordedPrograms {
        return this.recorded;
    }

    /**
    * tags の取得
    * @return RecordedTags
    */
    public getTags(): apid.RecordedTags {
        return this.tags;
    }
}

export { findQuery, RecordedApiModelInterface, RecordedApiModel };

