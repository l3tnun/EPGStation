import { Operation } from 'express-openapi';
import * as api from '../../api';
import factory from '../../../Model/ModelFactory';
import { ScheduleModelInterface } from '../../../Model/Api/ScheduleModel';

export const get: Operation = async (req, res) => {
    let schedules = <ScheduleModelInterface>(factory.get('ScheduleModel'));

    try {
        let results = await schedules.getScheduleId(req.query.time, req.params.id);
        api.responseJSON(res, 200, results);
    } catch(err) {
        if(err.message === ScheduleModelInterface.channelIdIsNotFoundError) {
            api.responseError(res, { code: 404,  message: 'channelId is not found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: 'チャンネル別の番組表を一週間分取得',
    tags: ['schedule'],
    description: 'チャンネル別の番組表を一週間分取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'channel id',
            required: true,
            type: 'integer'
        },
        { $ref: '#/parameters/scheduleTime' },
    ],
    responses: {
        200: {
            description: 'チャンネル別の番組表を取得しました',
            schema: {
                $ref: '#/definitions/SchedulePrograms'
            }
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

