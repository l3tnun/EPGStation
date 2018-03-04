import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../Model/Api/StreamsModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const del: Operation = async(_req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');

    try {
        await streams.forcedStopAll();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'すべてのストリームを強制停止',
    tags: ['streams'],
    description: 'すべてのストリームを強制停止する',
    responses: {
        200: {
            description: 'すべてのストリームを強制停止しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

