import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../Model/Api/RecordedModel';
import factory from '../../Model/ModelFactory';
import * as api from '../api';

export const get: Operation = async(req, res) => {
    const recorded = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        const results = await recorded.getAll(req.query.limit, req.query.offset, {
            ruleId: req.query.rule === 0 ? null : req.query.rule,
            genre1: req.query.genre1,
            channelId: req.query.channel,
            keyword: req.query.keyword,
        });
        api.responseJSON(res, 200, results);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画一覧を取得',
    tags: ['recorded'],
    description: '録画一覧を取得する',
    parameters: [
        { $ref: '#/parameters/limit' },
        { $ref: '#/parameters/offset' },
        { $ref: '#/parameters/rule' },
        { $ref: '#/parameters/genre1' },
        { $ref: '#/parameters/channel' },
        { $ref: '#/parameters/recordedKeyword' },
    ],
    responses: {
        200: {
            description: '録画一覧を取得しました',
            schema: {
                type: 'object',
                properties: {
                    recorded: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/RecordedProgram',
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

