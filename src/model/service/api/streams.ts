import { Operation } from 'express-openapi';
import IStreamApiModel from '../../api/stream/IStreamApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const del: Operation = async (_req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        await streamApiModel.stopAll();
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '全てのストリームを停止',
    tags: ['streams'],
    description: '全てのストリームを停止する',
    responses: {
        200: {
            description: '全てのストリームを停止しました',
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
