import { Operation } from 'express-openapi';
import IEncodeApiModel from '../../api/encode/IEncodeApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/** `GET /encode` ハンドラ。`IEncodeApiModel#getAll` で実行中/待機中のエンコード情報一覧を返す。 */
export const get: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        api.responseJSON(res, 200, await encodeApiModel.getAll(req.query.isHalfWidth as any as boolean));
    } catch (err: any) {
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

/** `POST /encode` ハンドラ。`IEncodeApiModel#add` で手動エンコードを追加し、発行された id を返す。 */
export const post: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        api.responseJSON(res, 201, {
            encodeId: await encodeApiModel.add(req.body),
        });
    } catch (err: any) {
        api.responseOperationError(res, err);
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
