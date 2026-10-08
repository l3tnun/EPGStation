import { Operation } from 'express-openapi';
import type * as apid from '../../../../api.js';
import IRecordedTagApiModel from '../../api/recordedTag/IRecordedTagApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/**
 * `GET /tags` ハンドラ。query の offset / limit / name / excludeTagId から検索条件を組み立て、
 * `IRecordedTagApiModel#gets` で録画タグ一覧を返す。
 */
export const get: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const option: apid.GetRecordedTagOption = {};
        if (typeof req.query.offset !== 'undefined') {
            option.offset = parseInt(req.query.offset as any, 10);
        }
        if (typeof req.query.limit !== 'undefined') {
            option.limit = parseInt(req.query.limit as any, 10);
        }
        if (typeof req.query.name === 'string') {
            option.name = req.query.name;
        }
        if (typeof req.query.excludeTagId !== 'undefined') {
            option.excludeTagId = (req.query.excludeTagId as string[]).map(s => {
                return parseInt(s, 10);
            });
        }
        api.responseJSON(res, 200, await recordedTagApiModel.gets(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'タグ情報取得',
    tags: ['tags'],
    description: 'タグ情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/QueryName',
        },
        {
            $ref: '#/components/parameters/QueryExcludeRecordedTagId',
        },
    ],
    responses: {
        200: {
            description: 'タグ情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedTags',
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

/** `POST /tags` ハンドラ。`IRecordedTagApiModel#create` でタグを追加し、発行された id を返す。 */
export const post: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const name: string = req.body.name;
        const color: string = req.body.color;
        const tagId = await recordedTagApiModel.create(name, color);
        api.responseJSON(res, 201, {
            tagId: tagId,
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'タグ追加',
    tags: ['tags'],
    description: 'タグを追加する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/AddRecordedTagOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: 'タグの追加に成功した',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/AddedRecordedTag',
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
