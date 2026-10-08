import { Operation } from 'express-openapi';
import IRuleApiModel from '../../../../api/rule/IRuleApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/** `PUT /rules/{ruleId}/enable` ハンドラ。`IRuleApiModel#enable` でルールを有効化する。 */
export const put: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        await ruleApiModel.enable(parseInt(api.pathParam(req, 'ruleId'), 10));

        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ルール有効化',
    tags: ['rules'],
    description: 'ルールを有効化する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
    ],
    responses: {
        200: {
            description: 'ルールを有効化しました',
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
