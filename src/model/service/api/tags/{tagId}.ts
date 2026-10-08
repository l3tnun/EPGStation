import { Operation } from 'express-openapi';
import type * as apid from '../../../../../api.js';
import IRecordedTagApiModel from '../../../api/recordedTag/IRecordedTagApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/** `DELETE /tags/{tagId}` ハンドラ。`IRecordedTagApiModel#delete` でタグを削除する。 */
export const del: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const tagId: apid.RecordedTagId = parseInt(api.pathParam(req, 'tagId'), 10);
        await recordedTagApiModel.delete(tagId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'タグ削除',
    tags: ['tags'],
    description: 'タグを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedTagId',
        },
    ],
    responses: {
        200: {
            description: 'タグを削除しました',
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

/** `PUT /tags/{tagId}` ハンドラ。`IRecordedTagApiModel#update` でタグ名・色を変更する。 */
export const put: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const tagId: apid.RecordedTagId = parseInt(api.pathParam(req, 'tagId'), 10);
        const name: string = req.body.name;
        const color: string = req.body.color;
        await recordedTagApiModel.update(tagId, name, color);
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'タグ名変更',
    tags: ['tags'],
    description: 'タグ名を変更する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedTagId',
        },
    ],
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
        200: {
            description: 'タグの更新に成功した',
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
