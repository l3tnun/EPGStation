import { Operation } from 'express-openapi';
import IScheduleApiModel from '../../../api/schedule/IScheduleApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    (<any>req.query).channelId = parseInt(req.params.channelId, 10);
    (<any>req.query).startAt = parseInt((<any>req.query).startAt, 10);
    try {
        api.responseJSON(res, 200, await scheduleApiModel.getChannelSchedule(req.query as any));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '指定された放送局の番組表情報取得',
    tags: ['schedules'],
    description: '指定された放送局の番組表情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
        {
            $ref: '#/components/parameters/StartAt',
        },
        {
            $ref: '#/components/parameters/Days',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '指定された放送局の番組表情報を取得しました',
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
