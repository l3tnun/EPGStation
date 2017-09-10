import { Operation } from 'express-openapi';
import * as api from '../../api';
import factory from '../../../Model/ModelFactory';
import { ReservesModelInterface } from '../../../Model/Api/ReservesModel';

export const get: Operation = async (req, res) => {
    let reserves = <ReservesModelInterface>(factory.get('ReservesModel'));

    try {
        let results = await reserves.getSkips(req.query.limit, req.query.offset);
        api.responseJSON(res, 200, results);
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '予約スキップ一覧を取得',
    tags: ['reserves'],
    description: '予約スキップ一覧を取得する',
    parameters: [
        { $ref: '#/parameters/limit' },
        { $ref: '#/parameters/offset' },
    ],
    responses: {
        200: {
            description: '予約スキップ一覧を取得しました',
            schema: {
                type: 'object',
                properties: {
                    reserves: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/Reserve'
                        }
                    },
                    total: { $ref: '#/definitions/total' }
                }
            }
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};
