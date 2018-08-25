import { EncodeManageModelInterface } from '../Service/Encode/EncodeManageModel';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';

interface EncodeModelInterface extends ApiModel {
    getAll(): {};
    cancel(id: string): Promise<void>;
}

class EncodeModel extends ApiModel implements EncodeModelInterface {
    private encodeManage: EncodeManageModelInterface;

    constructor(
        encodeManage: EncodeManageModelInterface,
    ) {
        super();
        this.encodeManage = encodeManage;
    }

    /**
     * エンコード中 or 待機中の一覧を取得
     * @return EncodingInfo
     */
    public getAll(): {} {
        return ApiUtil.deleteNullinHash(this.encodeManage.getEncodingInfo(false));
    }

    /**
     * エンコードキャンセル
     * @param id: string
     */
    public async cancel(id: string): Promise<void> {
        await this.encodeManage.cancel(id);
    }
}

export { EncodeModelInterface, EncodeModel };

