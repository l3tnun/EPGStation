import { Operation } from 'express-openapi';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        api.responseJSON(res, 200, await scheduleApiModel.getSchedule(req.query as any));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '番組表情報取得',
    tags: ['schedules'],
    description: '番組表情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/StartAt',
        },
        {
            $ref: '#/components/parameters/EndAt',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
        {
            $ref: '#/components/parameters/requiredGR',
        },
        {
            $ref: '#/components/parameters/requiredBS',
        },
        {
            $ref: '#/components/parameters/requiredCS',
        },
        {
            $ref: '#/components/parameters/requiredSKY',
        },
    ],
    responses: {
        200: {
            description: '番組表情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Schedules',
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
