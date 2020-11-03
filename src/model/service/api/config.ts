import { Operation } from 'express-openapi';
import IConfigApiModel from '../../api/config/IConfigApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const configApiModel = container.get<IConfigApiModel>('IConfigApiModel');

    try {
        api.responseJSON(res, 200, await configApiModel.getConfig(api.isSecureProtocol(req)));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'config 情報取得',
    tags: ['config'],
    description: 'config 情報を取得する',
    responses: {
        200: {
            description: 'config 情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Config',
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
