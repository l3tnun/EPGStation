import { Operation } from 'express-openapi';
import * as api from '../../api';
import factory from '../../../Model/ModelFactory';
import { ScheduleModelInterface } from '../../../Model/Api/ScheduleModel';

export const get: Operation = async (req, res) => {
    let schedules = <ScheduleModelInterface>(factory.get('ScheduleModel'));

    try {
        let results = await schedules.getBroadcasting(req.query.time);
        api.responseJSON(res, 200, results);
    } catch(err) {
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
                $ref: '#/definitions/ScheduleProgram'
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

