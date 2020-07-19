import { Operation } from 'express-openapi';
import IReserveApiModel from '../../../api/reserve/IReserveApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        api.responseJSON(
            res,
            200,
            await reserveApiModel.getLists({
                startAt: parseInt(req.query.startAt as string, 10),
                endAt: parseInt(req.query.endAt as string, 10),
            }),
        );
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '予約リスト情報取得',
    tags: ['reserves'],
    description: '予約リスト情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/StartAt',
        },
        {
            $ref: '#/components/parameters/EndAt',
        },
    ],
    responses: {
        200: {
            description: '予約リスト情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ReserveLists',
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
