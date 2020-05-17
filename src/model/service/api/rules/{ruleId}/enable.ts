import { Operation } from 'express-openapi';
import IRuleApiModel from '../../../../api/rule/IRuleApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        await ruleApiModel.enable(parseInt(req.params.ruleId, 10));

        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
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
