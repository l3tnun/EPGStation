import { Operation } from 'express-openapi';
import IReserveApiModel from '../../../../api/reserve/IReserveApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/** `DELETE /reserves/{reserveId}/overlap` ハンドラ。`IReserveApiModel#removeOverlap` で重複状態を解除する。 */
export const del: Operation = async (req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        api.responseJSON(res, 200, await reserveApiModel.removeOverlap(parseInt(api.pathParam(req, 'reserveId'), 10)));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '予約の重複状態を解除',
    tags: ['reserves'],
    description: '予約の重複状態を解除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathReserveId',
        },
    ],
    responses: {
        200: {
            description: '予約の重複状態を解除しました',
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
