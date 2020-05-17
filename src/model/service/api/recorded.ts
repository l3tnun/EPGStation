import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../api/recorded/IRecordedApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        api.responseJSON(res, 200, await recordedApiModel.gets(req.query as any));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画情報取得',
    tags: ['recorded'],
    description: '録画情報を取得する',
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
            description: '録画情報を取得しました',
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
