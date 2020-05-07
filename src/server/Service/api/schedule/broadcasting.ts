import { Operation } from 'express-openapi';
import { ScheduleModelInterface } from '../../../Model/Api/ScheduleModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(req, res) => {
    const schedules = <ScheduleModelInterface> factory.get('ScheduleModel');

    try {
        const results = await schedules.getBroadcasting(req.query.time as any as number);
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '放映中の番組データを取得',
    tags: ['schedule'],
    description: '放映中の番組データを取得する',
    parameters: [
        { $ref: '#/parameters/scheduleAddition' },
    ],
    responses: {
        200: {
            description: '放映中の番組データを取得しました',
            schema: {
                $ref: '#/definitions/ScheduleProgram',
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

