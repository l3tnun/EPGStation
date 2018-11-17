import { Operation } from 'express-openapi';
import { ReservesModelInterface } from '../../../../Model/Api/ReservesModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';

export const get: Operation = async(req, res) => {
    const reserves = <ReservesModelInterface> factory.get('ReservesModel');

    try {
        const result = await reserves.getPosition(req.params.id);
        api.responseJSON(res, 200, result);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '指定した programId の予約の位置を取得',
    tags: ['reserves'],
    description: '指定した programId の予約の位置を取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'program id',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: '指定した programId の予約の位置を取得しました',
            schema: {
                $ref: '#/definitions/ReservePositionResult',
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

