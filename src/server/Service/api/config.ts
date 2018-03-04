import { Operation } from 'express-openapi';
import { ConfigModelInterface } from '../../Model/Api/ConfigModel';
import factory from '../../Model/ModelFactory';
import * as api from '../api';

export const get: Operation = async(_req, res) => {
    const config = <ConfigModelInterface> factory.get('ConfigModel');

    try {
        const results = await config.getConfig();
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'config を取得',
    tags: ['config'],
    description: 'config を取得する',
    responses: {
        200: {
            description: 'config を取得しました',
            schema: {
                $ref: '#/definitions/Config',
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

