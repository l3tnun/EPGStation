import { Operation } from 'express-openapi';
import IEncodeApiModel from '../../api/encode/IEncodeApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const post: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        api.responseJSON(res, 201, {
            encodeId: await encodeApiModel.add(req.body),
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'エンコード追加',
    tags: ['encode'],
    description: 'エンコードを追加する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/AddManualEncodeProgramOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: 'エンコードの追加に成功した',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/AddedEncode',
                    },
                },
            },
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
