import { Operation } from 'express-openapi';
import IReserveApiModel from '../../../api/reserve/IReserveApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `POST /reserves/update` ハンドラ。予約の更新（全ルール予約を最新の番組情報で再計算する処理）を
 * 手動で始める trigger で、`IReserveApiModel#updateAll` が更新の処理を開始した時点で 200 を返す。
 * 更新の完了は待たない。開始後に更新が失敗しても、このハンドラの応答には反映されない。
 */
export const post: Operation = async (_req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        await reserveApiModel.updateAll();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '予約情報の更新開始',
    tags: ['reserves'],
    description: '予約情報の更新を開始する',
    responses: {
        200: {
            description: '予約情報の更新を開始しました',
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
