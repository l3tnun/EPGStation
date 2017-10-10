import { Operation } from 'express-openapi';
import * as api from '../api';
import factory from '../../Model/ModelFactory';
import { ReservesModelInterface } from '../../Model/Api/ReservesModel';

export const get: Operation = async (req, res) => {
    let reserves = <ReservesModelInterface>(factory.get('ReservesModel'));

    try {
        let results = await reserves.getReserves(req.query.limit, req.query.offset);
        api.responseJSON(res, 200, results);
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '予約一覧を取得',
    tags: ['reserves'],
    description: '予約一覧を取得する',
    parameters: [
        { $ref: '#/parameters/limit' },
        { $ref: '#/parameters/offset' },
    ],
    responses: {
        200: {
            description: '予約一覧を取得しました',
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

export const post: Operation = async (req, res) => {
    let reserves = <ReservesModelInterface>(factory.get('ReservesModel'));

    try {
        await reserves.addReserve(req.body.programId, req.body.encode);
        api.responseJSON(res, 201, { code: 201 });
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '予約 を追加',
    tags: ['reserves'],
    description: '予約 を追加する',
    parameters: [
        {
            name: 'body',
            in: 'body',
            required: true,
            schema: {
                $ref: '#/definitions/AddReserve'
            }
        }
    ],
    responses: {
        201: {
            description: '予約を追加しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
}

