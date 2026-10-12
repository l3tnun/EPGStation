import { Operation } from 'express-openapi';
import IReserveApiModel from '../../../api/reserve/IReserveApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /reserves/{reserveId}` ハンドラ。`IReserveApiModel#get` で予約1件を取得する。
 * `get` が `null`（該当予約なし）を返した場合は 404、それ以外の例外は 500 として返す。
 */
export const get: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        const reserve = await reserveApiModel.get(
            parseInt(api.pathParam(req, 'reserveId'), 10),
            req.query.isHalfWidth as any,
        );
        if (reserve === null) {
            api.responseError(res, {
                code: 404,
                message: 'reserve is not found',
            });
        } else {
            api.responseJSON(res, 200, reserve);
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '指定された予約情報の取得',
    tags: ['reserves'],
    description: '指定された予約情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathReserveId',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '指定された予約情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ReserveItem',
                    },
                },
            },
        },
        404: {
            description: 'Not Found',
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

/** `DELETE /reserves/{reserveId}` ハンドラ。`IReserveApiModel#cancel` で予約を取り消す。 */
export const del: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        api.responseJSON(res, 200, await reserveApiModel.cancel(parseInt(api.pathParam(req, 'reserveId'), 10)));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '予約削除',
    tags: ['reserves'],
    description: '予約を削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathReserveId',
        },
    ],
    responses: {
        200: {
            description: '予約を削除しました',
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

/** `PUT /reserves/{reserveId}` ハンドラ。`IReserveApiModel#edit` で手動予約の内容を更新する。 */
export const put: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        await reserveApiModel.edit(parseInt(api.pathParam(req, 'reserveId'), 10), req.body as any);
        api.responseJSON(res, 201, {
            code: 201,
            message: 'ok',
        });
    } catch (err: any) {
        api.responseOperationError(res, err);
    }
};

put.apiDoc = {
    summary: '手動予約更新',
    tags: ['reserves'],
    description: '手動予約を更新する',
    parameters: [
        {
            $ref: '#/components/parameters/PathReserveId',
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/EditManualReserveOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: '手動予約の更新に成功した',
        },
        409: {
            description: '編集の対象ではない予約（自動予約とルール由来の番組リレー予約）は編集できない',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
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
