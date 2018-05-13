import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../../../../Model/Api/StreamsModel';
import factory from '../../../../../../Model/ModelFactory';
import * as api from '../../../../../api';

export const get: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');

    try {
        const list = await streams.getRecordedStreamingM3u8(req.headers.host, req.secure, req.params.id, req.query.mode);
        api.responsePlayList(req, res, list);
    } catch (err) {
        if (err.message === StreamsModelInterface.recordedIsNotFoundError) {
            api.responseError(res, { code: 404,  message: 'recorded id is not Found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '録画ストリーミング (mpegts) 配信のプレイリストを取得',
    tags: ['streams'],
    description: '録画ストリーミング (mpegts) 配信のプレイリストを取得する',
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
    ],
    produces: [
        'application/x-mpegURL',
    ],
    responses: {
        200: {
            description: 'ok',
        },
        404: {
            description: 'Not found',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

