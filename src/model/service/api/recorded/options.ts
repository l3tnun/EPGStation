import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        const list = await recordedApiModel.getSearchOptionList();
        api.responseJSON(res, 200, list);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画検索オプションを取得',
    tags: ['recorded'],
    description: '録画検索オプションを取得する',
    responses: {
        200: {
            description: '録画検索オプションを取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedSearchOptions',
                    },
                },
            },
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
