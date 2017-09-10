import { Operation } from 'express-openapi';
import * as api from '../api';
import factory from '../../Model/ModelFactory';
import { StorageModelInterface } from '../../Model/Api/StorageModel';

export const get: Operation = async (_req, res) => {
    let storage = <StorageModelInterface>(factory.get('StorageModel'));

    try {
        let results = await storage.getStatus();
        api.responseJSON(res, 200, results);
    }  catch(err) {
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
            }
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

