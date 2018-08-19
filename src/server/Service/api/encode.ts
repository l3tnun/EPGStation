import { Operation } from 'express-openapi';
import { EncodeModelInterface } from '../../Model/Api/EncodeModel';
import factory from '../../Model/ModelFactory';
import * as api from '../api';

export const get: Operation = async(_req, res) => {
    const encode = <EncodeModelInterface> factory.get('EncodeModel');

    try {
        const results = await encode.getAll();
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'エンコード一覧を取得',
    tags: ['encode'],
    description: 'エンコード一覧を取得する',
    responses: {
        200: {
            description: 'エンコード一覧を取得しました',
            schema: {
                $ref: '#/definitions/EncodingInfo',
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

