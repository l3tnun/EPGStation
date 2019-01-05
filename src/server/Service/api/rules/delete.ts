import { Operation } from 'express-openapi';
import { RulesModelInterface } from '../../../Model/Api/RulesModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const post: Operation = async(req, res) => {
    const rules = <RulesModelInterface> factory.get('RulesModel');

    try {
        await rules.deleteRules(
            req.body.ruleIds,
            typeof req.body.delete === 'undefined' ? false : req.body.delete,
        );
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'ルールを複数削除',
    tags: ['rules'],
    description: 'ルールを複数削除する',
    parameters: [
        {
            name: 'body',
            in: 'body',
            required: true,
            schema: {
                $ref: '#/definitions/RuleDeletes',
            },
        },
    ],
    responses: {
        200: {
            description: 'rule を複数削除しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

