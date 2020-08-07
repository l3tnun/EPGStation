import { Operation } from 'express-openapi';
import IEncodeApiModel from '../../../api/encode/IEncodeApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const del: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        await encodeApiModel.cancel(parseInt(req.params.encodeId, 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'エンコードをキャンセル',
    tags: ['encode'],
    description: 'エンコードをキャンセルする',
    parameters: [
        {
            $ref: '#/components/parameters/PathEncodeId',
        },
    ],
    responses: {
        200: {
            description: 'エンコードをキャンセルしました',
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
