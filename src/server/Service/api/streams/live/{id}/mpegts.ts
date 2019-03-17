import { Operation } from 'express-openapi';
import { StreamModelInfo, StreamsModelInterface } from '../../../../../Model/Api/StreamsModel';
import factory from '../../../../../Model/ModelFactory';
import * as api from '../../../../api';

export const get: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');
    let isClosed: boolean = false;

    const stop = async() => {
        if (info === null) {  return; }
        info.stream.countDown();
        await streams.stop(info.streamNumber);
    };

    // 接続切断時
    req.on('close', async() => {
        isClosed = true;
        await stop();
    });

    let info: StreamModelInfo | null = null;
    try {
        // stream 取得
        info = await streams.getLiveMpegTs(req.params.id, req.query.mode);
        const encChild = info.stream.getEncChild();
        const mirakurunStream = info.stream.getMirakurunStream();

        if (isClosed) {
            await stop();
        }

        res.setHeader('Content-Type', 'video/MP2T');
        res.status(200);

        if (encChild !== null) {
            if (encChild.stdout !== null) { encChild.stdout.pipe(res); }

            // enc コマンド終了時
            encChild.on('exit', async() => {
                if (info !== null) { info.stream.resetCount(); }
                res.end();
            });

            // enc コマンドエラー時
            encChild.on('error', async() => {
                if (info !== null) { info.stream.resetCount(); }
                res.end();
            });

            // カウントアップする
            info.stream.countUp();
        } else if (mirakurunStream !== null) {
            // 無変換
            mirakurunStream.pipe(res);

            // ストリーム終了 or エラー時の処理
            mirakurunStream.on('close', async() => {
                if (info !== null) { info.stream.resetCount(); }
                res.end();
            });

            mirakurunStream.on('exit', async() => {
                if (info !== null) { info.stream.resetCount(); }
                res.end();
            });

            mirakurunStream.on('error', async() => {
                if (info !== null) { info.stream.resetCount(); }
                res.end();
            });

            // カウントアップする
            info.stream.countUp();
        } else {
            // stream 生成に失敗
            info.stream.resetCount();
            throw new Error('CreatetMpegTsLiveStreamChildError');
        }
    } catch (err) {
        api.responseServerError(res, err.message);
        if (info !== null) {
            (<StreamModelInfo> info).stream.resetCount();
        }
    }
};

get.apiDoc = {
    summary: 'mpegts ライブ配信',
    tags: ['streams'],
    description: 'mpegts ライブ配信をする',
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
    produces: ['video/MP2T'],
    responses: {
        200: {
            description: 'mpegts ストリーム',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

