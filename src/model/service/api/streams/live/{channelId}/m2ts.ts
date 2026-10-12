import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel.js';
import container from '../../../../../ModelContainer.js';
import * as api from '../../../../api.js';

/**
 * `GET /streams/live/{channelId}/m2ts` ハンドラ。`IStreamApiModel#startLiveM2TsStream` で
 * 開始したストリームを response へ直接 pipe し続ける（接続を保持したまま配信する）。
 * 10秒間隔で `keep` を呼んで停止タイマーを延長しつつ、client 切断（`req` の `close`）や
 * 配信側の終了/異常（`stream` の `close`/`exit`/`error`）を検知して停止・応答終了させる。
 * `startLiveM2TsStream` の完了前に client が切断していた場合（`isClosed`）は、開始した
 * ストリームをそのまま停止して pipe しない。
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
        result = await streamApiModel.startLiveM2TsStream({
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
    summary: 'ライブ M2TS ストリーム',
    tags: ['streams'],
    description: 'ライブ M2TS ストリームを取得する',
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
            description: 'ライブ M2TS ストリーム',
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
