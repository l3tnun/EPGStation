import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import { UploadedVideoFileOption } from '../../../operator/recorded/IRecordedManageModel';
import * as api from '../../api';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        if (typeof req.body.file === 'undefined') {
            throw new Error('FileIsNotFound');
        }

        const option: UploadedVideoFileOption = {
            recordedId: req.body.recordedId,
            parentDirectoryName: req.body.parentDirectoryName,
            viewName: req.body.viewName,
            fileType: req.body.fileType,
            fileName: req.file.originalname,
            filePath: req.file.path,
        };
        if (typeof req.body.subDirectory !== 'undefined') {
            option.subDirectory = req.body.subDirectory;
        }

        await recordedApiModel.addUploadedVideoFile(option);

        api.responseJSON(res, 200, { code: 200, result: 'ok' });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'アップロードしたビデオファイルを追加',
    tags: ['videos'],
    description: 'アップロードしたビデオファイルを追加する',
    requestBody: {
        content: {
            'multipart/form-data': {
                schema: {
                    $ref: '#/components/schemas/UploadVideoFileOption',
                },
            },
        },
    },
    responses: {
        200: {
            description: 'アップロードしたビデオファイルを追加しました',
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
