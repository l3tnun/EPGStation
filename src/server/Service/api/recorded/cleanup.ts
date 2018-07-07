import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../../Model/Api/RecordedModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const post: Operation = async(_req, res) => {
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        await recordeds.cleanup();
        api.responseJSON(res, 200, { code: 200 });
        api.notifyClient();
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画をクリーンアップ',
    tags: ['recorded'],
    description: '録画をクリーンアップする',
    responses: {
        200: {
            description: 'ok',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

