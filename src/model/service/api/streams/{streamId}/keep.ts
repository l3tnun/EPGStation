import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../api/stream/IStreamApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        await streamApiModel.keep(parseInt(req.params.streamId, 10));
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ストリーム停止タイマーを更新する',
    tags: ['streams'],
    description: 'ストリーム停止タイマーを更新する',
    parameters: [
        {
            $ref: '#/components/parameters/PathStreamId',
        },
    ],
    responses: {
        200: {
            description: 'ストリーム停止タイマーを更新しました',
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
