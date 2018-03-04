import { Operation } from 'express-openapi';
import { ReservesModelInterface } from '../../../Model/Api/ReservesModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(_req, res) => {
    const reserves = <ReservesModelInterface> factory.get('ReservesModel');

    try {
        const results = await reserves.getReserveAllId();
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '予約情報の program id を取得',
    tags: ['reserves'],
    description: '予約情報の program id を取得する',
    responses: {
        200: {
            description: '予約情報の program id を取得しました',
            schema: {
                $ref: '#/definitions/ReserveAllId',
            },
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};
