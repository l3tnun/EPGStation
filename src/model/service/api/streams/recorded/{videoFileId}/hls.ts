import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../api/stream/IStreamApiModel.js';
import container from '../../../../../ModelContainer.js';
import * as api from '../../../../api.js';

/**
 * `GET /streams/recorded/{videoFileId}/hls` ハンドラ。`IStreamApiModel#startRecordedHLSStream`
 * で録画済み番組のHLS配信を開始する。`ss`（query、再生開始位置）を指定できる。HLSは
 * セグメントファイル群として別経路で配信されるため、開始したストリームIDのみを返す。
 */
export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        const streamId = await streamApiModel.startRecordedHLSStream({
            videoFileId: parseInt(api.pathParam(req, 'videoFileId'), 10),
            playPosition: parseInt(req.query.ss as string, 10),
            mode: parseInt(req.query.mode as string, 10),
        });
        api.responseJSON(res, 200, {
            streamId: streamId,
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画 HLS ストリーム',
    tags: ['streams'],
    description: '録画 HLS ストリームを開始する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            $ref: '#/components/parameters/StreamPlayPosition',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: '録画 HLS ストリームを開始しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/StartStreamInfo',
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
