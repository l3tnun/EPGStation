import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../../Model/Api/RecordedModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const post: Operation = async(req, res) => {
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        // 削除できなかった要素を results に格納する
        const results = await recordeds.deleteRecordeds(req.body.recordedIds);
        api.responseJSON(res, 200, { code: 200, results: results });
        api.notifyClient();
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画を複数削除',
    tags: ['recorded'],
    description: '録画を複数削除する',
    parameters: [
        {
            name: 'body',
            in: 'body',
            required: true,
            schema: {
                $ref: '#/definitions/RecordedDeletes',
            },
        },
    ],
    responses: {
        200: {
            description: 'ok',
            schema: {
                type: 'object',
                required: [
                    'results',
                ],
                properties: {
                    results: {
                        description: '削除できなかった recorded id が格納される',
                        type: 'array',
                        items: {
                            $ref: '#/definitions/RecordedId',
                        },
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

