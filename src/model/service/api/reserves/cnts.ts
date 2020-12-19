import { Operation } from 'express-openapi';
import IReserveApiModel from '../../../api/reserve/IReserveApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        api.responseJSON(res, 200, await reserveApiModel.getCnts());
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '予約数取得',
    tags: ['reserves'],
    description: '予約数を取得する',
    responses: {
        200: {
            description: '予約数を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ReserveCnts',
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
