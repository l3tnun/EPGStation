import { Operation } from 'express-openapi';
import * as fs from 'fs';
import * as path from 'path';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    try {
        const pkg = <any>(
            JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'))
        );
        api.responseJSON(res, 200, { version: pkg.version });
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
