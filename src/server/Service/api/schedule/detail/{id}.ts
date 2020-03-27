import { Operation } from 'express-openapi';
import { ScheduleModelInterface } from '../../../../Model/Api/ScheduleModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';

export const get: Operation = async(req, res) => {
    const schedules = <ScheduleModelInterface> factory.get('ScheduleModel');

    try {
        const results = await schedules.getScheduleDetail(parseInt(req.params.id, 10));
        api.responseJSON(res, 200, results);
    } catch (err) {
        if (err.message === ScheduleModelInterface.channelIdIsNotFoundError) {
            api.responseError(res, { code: 404,  message: 'channelId is not found' });
        } else if (err.message === ScheduleModelInterface.programlIdIsNotFoundError) {
            api.responseError(res, { code: 404,  message: 'programId is not found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: 'program id を指定して番組詳細を取得',
    tags: ['schedule'],
    description: 'program id を指定して番組詳細を取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'program id',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: 'program id を指定して番組詳細を取得しました',
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

