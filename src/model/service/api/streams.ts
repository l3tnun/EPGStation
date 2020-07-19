import { Operation } from 'express-openapi';
import IStreamApiModel from '../../api/stream/IStreamApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        const infos = await streamApiModel.getStreamInfos((req.query.isHalfWidth as any) as boolean);
        api.responseJSON(res, 200, infos);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ストリーム情報を取得',
    tags: ['streams'],
    description: 'ストリーム情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: 'ストリーム情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/StreamInfo',
                    },
                },
            },
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
