import { Operation } from 'express-openapi';
import IDropLogApiModel, { DropLogApiErrors } from '../../../api/dropLog/IDropLogApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /dropLogs/{dropLogFileId}` ハンドラ。`IDropLogApiModel#getIdFilePath` でドロップログの
 * 絶対パスを取得して`text/plain`で返す。`maxsize`（query）を超えるファイルは
 * `DropLogApiErrors.FILE_IS_TOO_LARGE`により416、パスが`null`（該当ファイルなし）なら404。
 */
export const get: Operation = async (req, res) => {
    const dropLogApiModel = container.get<IDropLogApiModel>('IDropLogApiModel');

    try {
        const filePath = await dropLogApiModel.getIdFilePath(
            parseInt(api.pathParam(req, 'dropLogFileId'), 10),
            parseInt(<string>req.query.maxsize, 10),
        );

        if (filePath === null) {
            api.responseError(res, {
                code: 404,
                message: 'drop log file is not Found',
            });
        } else {
            api.responseFile(req, res, filePath, 'text/plain', false);
        }
    } catch (err: any) {
        if (err.message === DropLogApiErrors.FILE_IS_TOO_LARGE) {
            api.responseError(res, {
                code: 416,
                message: 'log file is too large',
            });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: 'ドロップログ',
    tags: ['dropLogs'],
    description: 'ドロップログを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathDropLogFileId',
        },
        {
            $ref: '#/components/parameters/LogFileMaxSize',
        },
    ],
    responses: {
        200: {
            description: 'ドロップログを取得しました',
            content: {
                'text/plain': {},
            },
        },
        404: {
            description: 'Not Found',
        },
        416: {
            description: 'ファイルサイズが大きすぎる',
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
