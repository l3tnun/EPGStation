import { Operation } from 'express-openapi';
import { RulesModelInterface } from '../../../Model/Api/RulesModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(_req, res) => {
    const rules = <RulesModelInterface> factory.get('RulesModel');

    try {
        const results = await rules.getRuleList();
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'rule list を取得',
    tags: ['rules'],
    description: 'rule list を取得する',
    responses: {
        200: {
            description: 'rule list を取得しました',
            schema: {
                type: 'array',
                items: {
                    $ref: '#/definitions/RuleList',
                },
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

