import { Operation } from 'express-openapi';
import { StorageModelInterface } from '../../Model/Api/StorageModel';
import factory from '../../Model/ModelFactory';
import * as api from '../api';

export const get: Operation = async(_req, res) => {
    const storage = <StorageModelInterface> factory.get('StorageModel');

    try {
        const results = await storage.getStatus();
        api.responseJSON(res, 200, results);
    }  catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ストレージ情報を取得',
    tags: ['storage'],
    description: 'ストレージ情報を取得する',
    responses: {
        200: {
            description: 'ストレージ情報を取得しました',
            schema: {
                $ref: '#/definitions/StorageInfo',
            },
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

