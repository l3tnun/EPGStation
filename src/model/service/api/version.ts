import { Operation } from 'express-openapi';
import * as fs from 'fs';
import * as path from 'path';
import * as api from '../api.js';

/**
 * `GET /version` ハンドラ。EPGStation自体（`package.json`）のバージョン文字列を返す。
 * `package.json`のパスはコンパイル後の実行位置（このfile自身の`dist`配下の場所）を基準に
 * 4階層上へ遡って求めるため、ビルド出力の配置を変えると壊れる。
 */
export const get: Operation = async (_req, res) => {
    try {
        const pkg = <any>(
            JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'))
        );
        api.responseJSON(res, 200, { version: pkg.version });
    } catch (err: any) {
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
