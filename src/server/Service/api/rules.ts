import { Operation } from 'express-openapi';
import { RulesModelInterface } from '../../Model/Api/RulesModel';
import factory from '../../Model/ModelFactory';
import * as api from '../api';

export const get: Operation = async(req, res) => {
    const rules = <RulesModelInterface> factory.get('RulesModel');

    try {
        const results = await rules.getAll(req.query.limit, req.query.offset, {
            keyword: req.query.keyword,
        });
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'rule を取得',
    tags: ['rules'],
    description: 'rule を取得する',
    parameters: [
        { $ref: '#/parameters/limit' },
        { $ref: '#/parameters/offset' },
        { $ref: '#/parameters/ruleKeyword' },
    ],
    responses: {
        200: {
            description: 'rule を取得しました',
            schema: {
                type: 'object',
                properties: {
                    rules: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/Rule',
                        },
                    },
                    total: { $ref: '#/definitions/total' },
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

export const post: Operation = async(req, res) => {
    const rules = <RulesModelInterface> factory.get('RulesModel');

    try {
        const results = await rules.addRule(req.body);
        api.responseJSON(res, 201, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'rule を追加',
    tags: ['rules'],
    description: 'rule を追加する',
    parameters: [
        {
            name: 'body',
            in: 'body',
            description: '必要な項目の組み合わせが複雑なので Model を確認すること',
            required: true,
            schema: {
                $ref: '#/definitions/AddRule',
            },
        },
    ],
    responses: {
        201: {
            description: 'rule を追加しました',
            schema: {
                type: 'object',
                properties: {
                    id: {
                        $ref: '#/definitions/RuleId',
                    },
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

