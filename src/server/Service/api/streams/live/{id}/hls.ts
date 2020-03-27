import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../../../Model/Api/StreamsModel';
import factory from '../../../../../Model/ModelFactory';
import * as api from '../../../../api';

export const get: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');

    try {
        const streamNumber = await streams.getHLSLive(parseInt(req.params.id, 10), req.query.mode);

        api.responseJSON(res, 200, { streamNumber: streamNumber });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'HLS ライブ配信',
    tags: ['streams'],
    description: 'HLS ライブ配信をする',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'channel id',
            required: true,
            type: 'integer',
        },
        {
            name: 'mode',
            in: 'query',
            description: 'encode mode',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: 'HLS 配信開始',
            schema: {
                $ref: '#/definitions/HLSStream',
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

