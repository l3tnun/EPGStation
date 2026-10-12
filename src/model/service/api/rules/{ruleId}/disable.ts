import { Operation } from 'express-openapi';
import IRuleApiModel from '../../../../api/rule/IRuleApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/** `PUT /rules/{ruleId}/disable` ハンドラ。`IRuleApiModel#disable` でルールを無効化する。 */
export const put: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        await ruleApiModel.disable(parseInt(api.pathParam(req, 'ruleId'), 10));

        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ルール無効化',
    tags: ['rules'],
    description: 'ルールを無効化する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
    ],
    responses: {
        200: {
            description: 'ルールを無効化しました',
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
