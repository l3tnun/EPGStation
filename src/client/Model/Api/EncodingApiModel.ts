import * as apid from '../../../../api';
import ApiModel from './ApiModel';

interface EncodingApiModelInterface extends ApiModel {
    init(): void;
    fetchInfo(): Promise<void>;
    getInfo(): apid.EncodingInfo;
    stop(encodingId: string): Promise<void>;
    stops(ids: apid.EncodeId[]): Promise<void>;
}

/**
 * EncodingApiModel
 * /api/encode
 */
class EncodingApiModel extends ApiModel implements EncodingApiModelInterface {
    private info: apid.EncodingInfo = { queue: [] };

    public init(): void {
        super.init();

        this.info = {
            queue: [],
        };
    }

    /**
     * エンコード一覧を取得
     * /api/encode
     */
    public async fetchInfo(): Promise<void> {
        try {
            const info = await <any> this.request({
                method: 'GET',
                url: './api/encode',
            });

            this.info = info;
        } catch (err) {
            console.error('./api/encode');
            console.error(err);
            this.openSnackbar('エンコード情報取得に失敗しました');
        }
    }

    /**
     * info の取得
     * @return apid.EncodingInfo
     */
    public getInfo(): apid.EncodingInfo {
        return this.info;
    }

    /**
     * encode の停止
     * @param encodingId: encoding id
     */
    public async stop(encodingId: string): Promise<void> {
        await this.request({
            method: 'DELETE',
            url: `./api/encode/${ encodingId }`,
        });
    }

    /**
     * 複数の encode 停止
     * /api/encode/cancel post
     * @param ids: encode ids
     */
    public async stops(ids: apid.EncodeId[]): Promise<void> {
        await this.request({
            method: 'POST',
            url: './api/encode/cancel',
            body: {
                ids: ids,
            },
        });
    }
}

export { EncodingApiModelInterface, EncodingApiModel };

