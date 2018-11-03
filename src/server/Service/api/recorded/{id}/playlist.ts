import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../../../Model/Api/RecordedModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';

export const get: Operation = async(req, res) => {
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        const list = await recordeds.getM3u8(req.headers.host!, req.header('x-forwarded-proto') === 'https', req.params.id, req.query.encodedId);
        api.responsePlayList(req, res, list);
    } catch (err) {
        if (err.message === RecordedModelInterface.NotFoundRecordedFileError) {
            api.responseError(res, { code: 404,  message: 'Recorded file is not Found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '録画済みファイルのプレイリストを取得',
    tags: ['recorded'],
    description: '録画済みファイルのプレイリストを取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
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

