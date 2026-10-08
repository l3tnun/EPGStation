import { Operation } from 'express-openapi';
import IReserveApiModel from '../../../api/reserve/IReserveApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/** `GET /reserves/cnts` ハンドラ。`IReserveApiModel#getCnts` で正常/競合/重複/スキップの件数を返す。 */
export const get: Operation = async (_req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        api.responseJSON(res, 200, await reserveApiModel.getCnts());
    } catch (err: any) {
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
