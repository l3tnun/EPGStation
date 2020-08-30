import { Operation } from 'express-openapi';
import * as apid from '../../../../api';
import IReserveApiModel from '../../api/reserve/IReserveApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        const option: apid.GetReserveOption = {
            isHalfWidth: req.query.isHalfWidth as any,
        };
        if (typeof req.query.type !== 'undefined') {
            option.type = req.query.type as any;
        }
        if (typeof req.query.ruleId !== 'undefined') {
            option.ruleId = parseInt(req.query.ruleId as any, 10);
        }
        if (typeof req.query.offset !== 'undefined') {
            option.offset = parseInt(req.query.offset as any, 10);
        }
        if (typeof req.query.limit !== 'undefined') {
            option.limit = parseInt(req.query.limit as any, 10);
        }

        api.responseJSON(res, 200, await reserveApiModel.gets(option));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '予約情報取得',
    tags: ['reserves'],
    description: '予約情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/GetReserveType',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
        {
            $ref: '#/components/parameters/QueryRuleId',
        },
    ],
    responses: {
        200: {
            description: '予約情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Reserves',
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

export const post: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        api.responseJSON(res, 201, {
            reserveId: await reserveApiModel.add(req.body),
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '予約追加',
    tags: ['reserves'],
    description: '予約を追加する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/ManualReserveOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: '予約の追加に成功した',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/AddedReserve',
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
