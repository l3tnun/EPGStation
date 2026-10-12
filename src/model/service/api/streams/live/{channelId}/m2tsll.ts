import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel.js';
import container from '../../../../../ModelContainer.js';
import * as api from '../../../../api.js';

/**
 * `GET /streams/live/{channelId}/m2tsll` ハンドラ。`IStreamApiModel#startLiveM2TsLLStream`
 * （低遅延設定）で開始したストリームを response へ直接 pipe し続ける。lifecycle 管理
 * （keep timer・切断/終了検知）は `m2ts.ts` と同じ。
 */
export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    let isClosed: boolean = false;
    let result: StreamResponse;
    let keepTimer: NodeJS.Timeout;

    const stop = async () => {
        clearInterval(keepTimer);

        if (typeof result === 'undefined') {
            return;
        }

        await streamApiModel.stop(result.streamId, true);
    };

    req.on('close', async () => {
        isClosed = true;
        await stop();
    });

    try {
        result = await streamApiModel.startLiveM2TsLLStream({
            channelId: parseInt(api.pathParam(req, 'channelId'), 10),
            mode: parseInt(req.query.mode as string, 10),
        });
        keepTimer = setInterval(() => {
            streamApiModel.keep(result.streamId);
        }, 10 * 1000);
    } catch (err: any) {
        api.responseServerError(res, err.message);

        return;
    }

    if (isClosed !== false) {
        await stop();

        return;
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.status(200);

    result.stream.on('close', () => {
        res.end();
    });
    result.stream.on('exit', () => {
        res.end();
    });
    result.stream.on('error', () => {
        res.end();
    });

    result.stream.pipe(res);
};

get.apiDoc = {
    summary: 'ライブ M2TS Low Latency (mpegts.js 用) ストリーム',
    tags: ['streams'],
    description: 'ライブ M2TS Low Latency ストリームを取得する',
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
            description: 'ライブ M2TS Low Latency ストリーム',
            content: {
                'video/mp2t': {},
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
