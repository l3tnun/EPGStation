import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../api/stream/IStreamApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const del: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        await streamApiModel.stop(parseInt(req.params.streamId, 10));
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'ストリームを停止',
    tags: ['streams'],
    description: 'ストリームを停止する',
    parameters: [
        {
            $ref: '#/components/parameters/PathStreamId',
        },
    ],
    responses: {
        200: {
            description: 'ストリームを停止しました',
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
