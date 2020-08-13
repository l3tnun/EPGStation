import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IScheduleApiModel from '../../../api/schedule/IScheduleApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const option: apid.BroadcastingScheduleOption = {
            isHalfWidth: req.query.isHalfWidth as any,
        };
        if (typeof req.query.time !== 'undefined') {
            option.time = parseInt(req.query.time as any, 10);
        }

        api.responseJSON(res, 200, await scheduleApiModel.getBroadcastingSchedule(option));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '放映中の番組報取得',
    tags: ['schedules'],
    description: '放映中の番組報取得を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/AddtionTime',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '放映中の番組報取得を取得しました',
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
