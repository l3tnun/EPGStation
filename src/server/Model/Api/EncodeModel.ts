import * as apid from '../../../../api';
import * as DBSchema from '../DB/DBSchema';
import { EncodeManageModelInterface, EncodingInfo, EncodingProgram } from '../Service/Encode/EncodeManageModel';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';

interface EncodeModelInterface extends ApiModel {
    getAll(): apid.EncodingInfo;
    cancel(id: string): Promise<void>;
    cancels(ids: string[]): Promise<void>;
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
     * @return apid.EncodingInfo
     */
    public getAll(): apid.EncodingInfo {
        // tslint:disable-next-line: prefer-object-spread
        const info = Object.assign({}, this.encodeManage.getEncodingInfo(false)) as EncodingInfo;

        const result: apid.EncodingInfo = {
            queue: [],
        };

        if (info.encoding !== null) {
            result.encoding = this.convertEncodingProgram(info.encoding);
        }

        result.queue = info.queue.map((data: EncodingProgram) => {
            return this.convertEncodingProgram(data);
        });

        return result;
    }

    /**
     * convertEncodingProgram
     * @param data: EncodingProgram
     * @return apid.EncodingProgram
     */
    private convertEncodingProgram(data: EncodingProgram): apid.EncodingProgram {
        // tslint:disable-next-line: prefer-object-spread
        const program = Object.assign({}, data.program) as DBSchema.RecordedSchema;
        const result: apid.EncodingProgram = {
            id: data.id,
            name: data.name,
            recordedId: data.recordedId,
            program: ApiUtil.convertToRecordedProgram(program),
        };

        if (typeof data.mode !== 'undefined') {
            result.mode = data.mode;
        }

        return result;
    }

    /**
     * エンコードキャンセル
     * @param id: string
     */
    public async cancel(id: string): Promise<void> {
        await this.encodeManage.cancel(id);
    }

    /**
     * エンコード複数キャンセル
     * @param ids: string[]
     */
    public async cancels(ids: string[]): Promise<void> {
        await this.encodeManage.cancels(ids);
    }
}

export { EncodeModelInterface, EncodeModel };

