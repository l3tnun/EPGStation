import { Operation } from 'express-openapi';
import IStorageApiModel from '../../api/storage/IStorageApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/** `GET /storages` ハンドラ。`IStorageApiModel#getInfo` でストレージの空き容量等の情報を返す。 */
export const get: Operation = async (_req, res) => {
    const storageApiModel = container.get<IStorageApiModel>('IStorageApiModel');

    try {
        const info = await storageApiModel.getInfo();
        api.responseJSON(res, 200, info);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ストレージ情報取得',
    tags: ['storages'],
    description: 'ストレージ情報を取得する',
    responses: {
        200: {
            description: 'ストレージ情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/StorageInfo',
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
