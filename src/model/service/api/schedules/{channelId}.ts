import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IScheduleApiModel from '../../../api/schedule/IScheduleApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const option: apid.ChannelScheduleOption = {
            startAt: parseInt(req.query.startAt as any, 10),
            days: parseInt(req.query.days as any, 10),
            isHalfWidth: req.query.isHalfWidth as any,
            channelId: parseInt(req.params.channelId, 10),
        };
        api.responseJSON(res, 200, await scheduleApiModel.getChannelSchedule(option));
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
