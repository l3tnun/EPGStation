import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../Model/Api/RecordedModel';
import factory from '../../Model/ModelFactory';
import * as api from '../api';

export const get: Operation = async(req, res) => {
    const recorded = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        const results = await recorded.getAll(req.query.limit, req.query.offset, req.query.reverse, {
            ruleId: req.query.rule === 0 ? null : req.query.rule,
            genre1: req.query.genre1,
            channelId: req.query.channel,
            keyword: req.query.keyword,
            onlyTs: req.query.onlyTs,
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
        { $ref: '#/parameters/reverse' },
        { $ref: '#/parameters/rule' },
        { $ref: '#/parameters/genre1' },
        { $ref: '#/parameters/channel' },
        { $ref: '#/parameters/recordedKeyword' },
        { $ref: '#/parameters/searchOnlyTs' },
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

export const post: Operation = async(req, res) => {
    const recorded = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        const result = await recorded.createNewRecorded(req.body);
        api.responseJSON(res, 201, result);
        api.notifyClient();
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画新規作成',
    tags: ['recorded'],
    description: '録画新規作成する',
    parameters: [
        {
            name: 'body',
            in: 'body',
            required: true,
            schema: {
                $ref: '#/definitions/NewRecorded',
            },
        },
    ],
    responses: {
        201: {
            description: 'ok',
            schema: {
                type: 'object',
                properties: {
                    id: {
                        $ref: '#/definitions/RecordedId',
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

