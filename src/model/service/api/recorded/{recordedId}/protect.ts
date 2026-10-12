import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/**
 * `PUT /recorded/{recordedId}/protect` ハンドラ。`IRecordedApiModel#changeProtect` を
 * `isProtect=true` で呼び、録画を自動削除対象から除外する。
 */
export const put: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        await recordedApiModel.changeProtect(parseInt(api.pathParam(req, 'recordedId'), 10), true);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: '録画を自動削除対象から除外',
    tags: ['recorded'],
    description: '録画を自動削除対象から除外する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
    ],
    responses: {
        200: {
            description: '録画を自動削除対象から除外しました',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
