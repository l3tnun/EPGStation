import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../../../Model/Api/StreamsModel';
import factory from '../../../../../Model/ModelFactory';
import { Stream } from '../../../../../Model/Service/Stream/Stream';
import * as api from '../../../../api';

export const get: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');
    let stream: Stream | null = null;
    let isClosed: boolean = false;

    const stop = async() => {
        if (stream === null) { return; }
        await stream.stop()
        .catch(() => {});
    };

    // 接続切断時
    req.on('close', async() => {
        isClosed = true;
        stop();
    });

    try {
        // stream 取得
        const info = await streams.getMP4Live(parseInt(req.params.id, 10), req.query.mode as any as number);
        stream = info.stream;
        const encChild = info.stream.getEncChild();

        if (isClosed) {
            await stop();

            return;
        }

        res.setHeader('Content-Type', 'video/mp4');
        res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.header('Expires', '-1');
        res.header('Pragma', 'no-cache');
        res.status(200);

        if (encChild !== null) {
            if (encChild.stdout !== null) { encChild.stdout.pipe(res); }

            // enc コマンド終了時
            encChild.on('exit', async() => {
                await stop();
                res.end();
            });

            // enc コマンドエラー時
            encChild.on('error', async() => {
                await stop();
                res.end();
            });
        } else {
            // stream 生成に失敗
            throw new Error('CreatetMP4LiveStreamChildError');
        }
    } catch (err) {
        await stop();

        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'mp4 ライブ配信',
    tags: ['streams'],
    description: 'mp4 ライブ配信をする',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'channel id',
            required: true,
            type: 'integer',
        },
        {
            name: 'mode',
            in: 'query',
            description: 'encode mode',
            required: true,
            type: 'integer',
        },
    ],
    produces: ['video/mp4'],
    responses: {
        200: {
            description: 'mp4 ストリーム',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

