import { Operation } from 'express-openapi';
import IIPCClient from '../../../ipc/IIPCClient.js';
import container from '../../../ModelContainer.js';
import { UploadedVideoFileOption } from '../../../operator/recorded/IRecordedManageModel.js';
import * as api from '../../api.js';
import { finishUploadRequest, getUploadRequestFinalizer } from '../../upload/UploadAdmissionController.js';

/**
 * `POST /videos/upload` ハンドラ。multerが`req.file`に格納した一時ファイルの登録をIPC経由で
 * 親processへ要求する。`getUploadRequestFinalizer`/`finishUploadRequest`で、multer middleware層
 * が管理する同時アップロード枠（`UploadAdmissionController`）の占有権を、成功・失敗・IPC
 * タイムアウトいずれの経路でも必ず一度だけ解放する。`disposition`が`confirmed-not-sent`なら
 * IPC送信自体の失敗として即エラーにし、そうでなければ親process側の受信cleanup予約
 * （`requestIncomingCleanupAfterSuccess`）をしたうえで最終的な登録完了（`completion`）を
 * 待って200を返す。途中でfinalizerが既に確定していた場合（client切断等）は二重に応答しない。
 */
export const post: Operation = async (req, res) => {
    const finalizer = getUploadRequestFinalizer(req);
    const wasFinalized = (): boolean => finalizer?.isFinished() === true;
    const finish = (reason: 'failure' | 'registration-timeout' | 'success'): void => {
        if (!wasFinalized()) finishUploadRequest(req, reason);
    };

    try {
        if (typeof req.file === 'undefined') {
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

        const ipc = container.get<IIPCClient>('IIPCClient');
        const attempt = ipc.uploadedVideoRegistrationPort.dispatch(option);
        const disposition = await attempt.disposition;
        if (wasFinalized()) return;
        if (disposition.kind === 'confirmed-not-sent') throw disposition.error;

        finalizer?.requestIncomingCleanupAfterSuccess();
        await disposition.completion;
        if (wasFinalized()) return;

        api.responseJSON(res, 200, { code: 200, result: 'ok' });
        finish('success');
    } catch (err: any) {
        if (wasFinalized()) return;
        finish(err instanceof Error && err.message === 'IPCTimeout' ? 'registration-timeout' : 'failure');
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
