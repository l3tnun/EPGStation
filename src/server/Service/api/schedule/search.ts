import { Operation } from 'express-openapi';
import { ScheduleModelInterface } from '../../../Model/Api/ScheduleModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const post: Operation = async(req, res) => {
    const schedules = <ScheduleModelInterface> factory.get('ScheduleModel');

    try {
        const results = await schedules.searchProgram(req.body);
        api.responseJSON(res, 200, results);
    } catch (err) {
        if (err.message === ScheduleModelInterface.searchOptionIsIncorrect) {
            api.responseError(res, { code: 400,  message: 'search option is incorrect' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

post.apiDoc = {
    summary: '番組検索結果を取得',
    tags: ['schedule'],
    description: '番組検索結果を取得する',
    parameters: [
        {
            name: 'body',
            in: 'body',
            description: '番組検索',
            required: true,
            schema: {
                $ref: '#/definitions/RuleSearch',
            },
        },
    ],
    responses: {
        200: {
            description: '番組検索結果を取得しました',
            schema: {
                $ref: '#/definitions/ScheduleSearch',
            },
        },
        400: {
            description: '検索オプションの指定が間違っている',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

