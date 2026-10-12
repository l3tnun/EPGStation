import { Operation } from 'express-openapi';
import IRecordingApiModel from '../../../api/recording/IRecordingApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `POST /recording/resettimer` ハンドラ。`IRecordingApiModel#resetTimer`（全録画のタイマーを
 * 最新の番組情報に基づいて再設定する処理）の完了を待ってから200を返す。
 */
export const post: Operation = async (_req, res) => {
    const recordingApiModel = container.get<IRecordingApiModel>('IRecordingApiModel');
    try {
        await recordingApiModel.resetTimer();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '予約タイマー再設定',
    tags: ['recording'],
    description: '予約タイマーを再設定する',
    responses: {
        200: {
            description: '予約タイマーを再設定しました',
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
