import * as apid from '../../../../api';
import ApiModel from './ApiModel';

interface EncodeApiModelInterface extends ApiModel {
    init(): void;
    fetchInfo(): Promise<void>;
    getInfo(): apid.EncodingInfo;
}

/**
 * EncodeApiModel
 * /api/encode
 */
class EncodeApiModel extends ApiModel implements EncodeApiModelInterface {
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
}

export { EncodeApiModelInterface, EncodeApiModel };

