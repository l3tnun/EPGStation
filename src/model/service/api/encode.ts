import { Operation } from 'express-openapi';
import IEncodeApiModel from '../../api/encode/IEncodeApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        api.responseJSON(res, 200, await encodeApiModel.getAll((req.query.isHalfWidth as any) as boolean));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'エンコード情報取得',
    tags: ['encode'],
    description: 'エンコード情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: 'エンコード情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/EncodeInfo',
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
