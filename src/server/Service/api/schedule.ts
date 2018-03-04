import { Operation } from 'express-openapi';
import { ScheduleModelInterface } from '../../Model/Api/ScheduleModel';
import factory from '../../Model/ModelFactory';
import * as api from '../api';

export const get: Operation = async(req, res) => {
    const schedules = <ScheduleModelInterface> factory.get('ScheduleModel');

    try {
        const results = await schedules.getSchedule(req.query.time, req.query.length, req.query.type);
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '番組表を取得',
    tags: ['schedule'],
    description: '番組表を取得する',
    parameters: [
        { $ref: '#/parameters/scheduleType' },
        { $ref: '#/parameters/scheduleTime' },
        { $ref: '#/parameters/scheduleLength' },
    ],
    responses: {
        200: {
            description: '番組表を取得しました',
            schema: {
                $ref: '#/definitions/SchedulePrograms',
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

