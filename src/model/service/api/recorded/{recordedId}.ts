import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /recorded/{recordedId}` ハンドラ。`IRecordedApiModel#get` で録画詳細を取得する。
 * `get` が `null`（該当録画なし）を返した場合は 404、それ以外の例外は 500 として返す。
 */
export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        const recorded = await recordedApiModel.get(
            parseInt(api.pathParam(req, 'recordedId'), 10),
            req.query.isHalfWidth as any as boolean,
        );
        if (recorded === null) {
            api.responseError(res, {
                code: 404,
                message: 'recorded is not Found',
            });
        } else {
            api.responseJSON(res, 200, recorded);
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画詳細情報を取得',
    tags: ['recorded'],
    description: '録画詳細情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '録画詳細情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedItem',
                    },
                },
            },
        },
        404: {
            description: '指定された id の 録画詳細情報がない',
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

/** `DELETE /recorded/{recordedId}` ハンドラ。`IRecordedApiModel#delete` で録画情報を削除する。 */
export const del: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        await recordedApiModel.delete(parseInt(api.pathParam(req, 'recordedId'), 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '録画を削除',
    tags: ['recorded'],
    description: '録画を削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
    ],
    responses: {
        200: {
            description: '録画を削除しました',
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
