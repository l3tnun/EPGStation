import { Operation } from 'express-openapi';
import IRecordingApiModel from '../../api/recording/IRecordingApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const recordingApiModel = container.get<IRecordingApiModel>('IRecordingApiModel');

    try {
        api.responseJSON(res, 200, await recordingApiModel.gets(req.query as any));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画中情報取得',
    tags: ['recording'],
    description: '録画中情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '録画中情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Records',
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
