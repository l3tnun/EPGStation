import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../Model/Api/StreamsModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const del: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');

    try {
        await streams.stop(req.params.id);
        api.responseJSON(res, 200, { code: 200 });
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
            name: 'id',
            in: 'path',
            description: 'stream id',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: 'ストリームを停止しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

