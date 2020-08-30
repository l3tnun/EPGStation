import { Operation } from 'express-openapi';
import IReserveApiModel from '../../../api/reserve/IReserveApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        const reserve = await reserveApiModel.get(parseInt(req.params.reserveId, 10), req.query.isHalfWidth as any);
        if (reserve === null) {
            api.responseError(res, {
                code: 404,
                message: 'reserve is not found',
            });
        } else {
            api.responseJSON(res, 200, reserve);
        }
    } catch (err) {
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

export const del: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        api.responseJSON(res, 200, await reserveApiModel.cancel(parseInt(req.params.reserveId, 10)));
    } catch (err) {
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

export const put: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        await reserveApiModel.edit(parseInt(req.params.reserveId, 10), req.body as any);
        api.responseJSON(res, 201, {
            code: 201,
            message: 'ok',
        });
    } catch (err) {
        api.responseServerError(res, err.message);
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
