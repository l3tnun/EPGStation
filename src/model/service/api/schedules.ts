import { Operation } from 'express-openapi';
import * as apid from '../../../../api';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const option: apid.ScheduleOption = {
            startAt: parseInt(req.query.startAt as any, 10),
            endAt: parseInt(req.query.endAt as any, 10),
            isHalfWidth: req.query.isHalfWidth as any,
            GR: req.query.GR as any,
            BS: req.query.BS as any,
            CS: req.query.CS as any,
            SKY: req.query.SKY as any,
        };
        api.responseJSON(res, 200, await scheduleApiModel.getSchedules(option));
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
