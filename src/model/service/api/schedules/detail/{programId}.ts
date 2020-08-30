import { Operation } from 'express-openapi';
import IScheduleApiModel from '../../../../api/schedule/IScheduleApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        api.responseJSON(
            res,
            200,
            await scheduleApiModel.getSchedule(parseInt(req.params.programId, 10), req.query.isHalfWidth as any),
        );
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '指定された番組表情報取得',
    tags: ['schedules'],
    description: '指定された番組表情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathProgramId',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '指定された番組表情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ScheduleProgramItem',
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
