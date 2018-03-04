import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../../../Model/Api/StreamsModel';
import factory from '../../../../../Model/ModelFactory';
import * as api from '../../../../api';

export const get: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');

    try {
        const streamNumber = await streams.getRecordedHLS(
            req.params.id,
            req.query.mode,
            typeof req.query.encodedId === 'undefined' ? null : req.query.encodedId,
        );

        api.responseJSON(res, 200, { streamNumber: streamNumber });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画済みファイルの HLS 配信',
    tags: ['streams'],
    description: '録画済みファイルの HLS 配信をする',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
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
        {
            name: 'encodedId',
            in: 'query',
            description: 'encoded id',
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

