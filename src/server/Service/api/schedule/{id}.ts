import { Operation } from 'express-openapi';
import { ScheduleModelInterface } from '../../../Model/Api/ScheduleModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(req, res) => {
    const schedules = <ScheduleModelInterface> factory.get('ScheduleModel');

    try {
        const results = await schedules.getScheduleId(req.query.time, parseInt(req.params.id, 10), req.query.days);
        api.responseJSON(res, 200, results);
    } catch (err) {
        if (err.message === ScheduleModelInterface.channelIdIsNotFoundError) {
            api.responseError(res, { code: 404,  message: 'channelId is not found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: 'チャンネル別の番組表を取得',
    tags: ['schedule'],
    description: 'チャンネル別の番組表を取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'channel id',
            required: true,
            type: 'integer',
        },
        {
            name: 'days',
            in: 'query',
            description: '表示する日数',
            type: 'integer',
            minimum: 1,
            maximum: 8,
            default: 7,
        },
        { $ref: '#/parameters/scheduleTime' },
    ],
    responses: {
        200: {
            description: 'チャンネル別の番組表を取得しました',
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

