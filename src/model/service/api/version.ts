import { Operation } from 'express-openapi';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    // TODO read package.json
    try {
        api.responseJSON(res, 200, { version: '2.0.0' });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'バージョン情報取得',
    tags: ['version'],
    description: 'バージョン情報を取得する',
    responses: {
        200: {
            description: 'バージョン情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Version',
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
