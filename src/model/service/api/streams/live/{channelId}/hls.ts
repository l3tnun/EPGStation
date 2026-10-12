import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../api/stream/IStreamApiModel.js';
import container from '../../../../../ModelContainer.js';
import * as api from '../../../../api.js';

/**
 * `GET /streams/live/{channelId}/hls` ハンドラ。`IStreamApiModel#startLiveHLSStream` で
 * ライブHLS配信を開始する。HLSはセグメントファイル群として別経路で配信されるため、他の
 * ライブ配信ハンドラと異なりストリーム本体は返さず、開始したストリームIDのみを返す。
 */
export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        const streamId = await streamApiModel.startLiveHLSStream({
            channelId: parseInt(api.pathParam(req, 'channelId'), 10),
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
    summary: 'ライブ HLS ストリーム',
    tags: ['streams'],
    description: 'ライブ HLS ストリームを開始する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: 'ライブ HLS ストリームを開始しました',
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
