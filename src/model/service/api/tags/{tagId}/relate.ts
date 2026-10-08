import { Operation } from 'express-openapi';
import type * as apid from '../../../../../../api.js';
import IRecordedTagApiModel from '../../../../api/recordedTag/IRecordedTagApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/** `DELETE /tags/{tagId}/relate` ハンドラ。`IRecordedTagApiModel#deleteRelation` でタグと録画番組の関連付けを解除する。 */
export const del: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const tagId: apid.RecordedTagId = parseInt(api.pathParam(req, 'tagId'), 10);
        const recordedId: apid.RecordedId = parseInt(req.query.recordedId as any, 10);
        await recordedTagApiModel.deleteRelation(tagId, recordedId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '録画番組とタグの関連付けを削除',
    tags: ['tags'],
    description: '録画番組とタグの関連付けを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedTagId',
        },
        {
            $ref: '#/components/parameters/QueryRecordedId',
        },
    ],
    responses: {
        200: {
            description: '録画番組とタグの関連付けを削除しました',
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

/**
 * `PUT /tags/{tagId}/relate` ハンドラ。`IRecordedTagApiModel#setRelation` でタグと録画番組を
 * 関連付ける。`del`（同ファイル）と異なり対象録画idは query ではなく body から取る。
 */
export const put: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const tagId: apid.RecordedTagId = parseInt(api.pathParam(req, 'tagId'), 10);
        const recordedId: apid.RecordedId = req.body.recordedId;
        await recordedTagApiModel.setRelation(tagId, recordedId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: '録画番組とタグを関連付ける',
    tags: ['tags'],
    description: '録画番組とタグを関連付けする',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedTagId',
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/RelateRecordedTagOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '録画番組とタグの関連付けに成功した',
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
