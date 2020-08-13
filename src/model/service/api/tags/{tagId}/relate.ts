import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import IRecordedTagApiModel from '../../../../api/recordedTag/IRecordedTagApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const del: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const tagId: apid.RecordedTagId = parseInt(req.params.tagId, 10);
        const recordedId: apid.RecordedId = parseInt(req.query.recordedId as any, 10);
        await recordedTagApiModel.deleteRelation(tagId, recordedId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
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

export const put: Operation = async (req, res) => {
    const recordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');

    try {
        const tagId: apid.RecordedTagId = parseInt(req.params.tagId, 10);
        const recordedId: apid.RecordedId = req.body.recordedId;
        await recordedTagApiModel.setRelation(tagId, recordedId);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
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
