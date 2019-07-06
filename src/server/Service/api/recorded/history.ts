import { Operation } from 'express-openapi';
import { RecordedHistoryModelInterface } from '../../../Model/Api/RecordedHistoryModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const del: Operation = async(_req, res) => {
    const history = <RecordedHistoryModelInterface> factory.get('RecordedHistoryModel');

    try {
        await history.clearAll();
        api.responseJSON(res, 204, { code: 204 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '録画履歴を削除',
    tags: ['recorded'],
    description: '録画履歴を削除する',
    responses: {
        204: {
            description: '録画履歴を削除しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

