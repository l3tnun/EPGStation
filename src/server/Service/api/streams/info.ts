import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../Model/Api/StreamsModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(_req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');

    try {
        const result = await streams.getInfos();
        api.responseJSON(res, 200, result);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ストリーム情報を取得',
    tags: ['streams'],
    description: 'ストリーム情報を取得する',
    responses: {
        200: {
            description: 'ストリーム情報を取得しました',
            schema: {
                $ref: '#/definitions/StreamInfos',
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

