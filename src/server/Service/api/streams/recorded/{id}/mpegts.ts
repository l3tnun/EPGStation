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
        await stop();
    });

    try {
        if (req.method === 'HEAD') {
            const header = await streams.getRecordedStreamingMpegTsHEADInfo(
                req.params.id,
                req.query.mode,
                req.query.ss,
                typeof req.headers.range === 'undefined' ? null : req.headers.range,
            );

            res.status(200);
            res.set(header);
            res.end();

            return;
        }

        const info = await streams.getRecordedStreamingMpegTs(
            req.params.id,
            req.query.mode,
            req.query.ss,
            typeof req.headers.range === 'undefined' ? null : req.headers.range,
        );
        stream = info.stream;
        const encChild = info.stream.getEncChild();

        if (isClosed) {
            await stop();

            return;
        }

        const responseInfo = info.stream.getResponseInfo();

        res.set(responseInfo.header);
        res.status(responseInfo.responseCode);

        if (encChild !== null) {
            encChild.stdout.pipe(res);

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
            throw new Error('CreatetRecordedStreamingMpegTsStreamChildError');
        }
    } catch (err) {
        await stop();

        if (err.message === Stream.OutOfRangeError) {
            api.responseError(res, { code: 416,  message: 'out of range' });
        } else if (err.message === Stream.FileIsNotFoundError) {
            api.responseError(res, { code: 404,  message: 'Recorded Id is not Found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '録画済みファイルの mpegts ストリーミング配信',
    tags: ['streams'],
    description: '録画済みファイルの mpegts ストリーミング配信をする',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
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
        {
            name: 'ss',
            in: 'query',
            description: '開始時刻(秒)',
            type: 'integer',
            default: 0,
        },
    ],
    responses: {
        200: {
            description: '配信開始',
        },
        404: {
            description: '指定された id の 録画ファイルがない',
        },
        416: {
            description: '範囲外',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

