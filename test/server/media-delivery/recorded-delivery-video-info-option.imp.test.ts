import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';

const RecordedDeliveryLeaseConsumer = compiled<any>(
    'model',
    'service',
    'stream',
    'recorded',
    'RecordedDeliveryLeaseConsumer.js',
).default;
const RecordedPlaybackSourceProvider = compiled<any>(
    'model',
    'operator',
    'recorded',
    'RecordedPlaybackSourceProvider.js',
).default;

const ffprobeFailure = 'Command failed: /usr/bin/ffprobe -v 0 -show_format -of json /synthetic/secret/recording.ts';

const makeProvider = (type: 'encoded' | 'ts', isRecording: boolean) => {
    const videoFileDB = { findId: vi.fn(async () => ({ id: 31, recordedId: 41, type })) };
    const recordedDB = { findId: vi.fn(async () => ({ id: 41, isRecording })) };
    const videoUtil = {
        getFullFilePathFromVideoFile: vi.fn(() => '/synthetic/secret/recording.ts'),
        getInfo: vi.fn(async () => {
            throw new Error(ffprobeFailure);
        }),
    };
    const reader = { close: vi.fn(async () => undefined), readable: {} };
    const readerFactory = {
        openCompletedFile: vi.fn(async () => reader),
        openRecordingTail: vi.fn(async () => reader),
    };
    return {
        provider: new RecordedPlaybackSourceProvider(videoFileDB, recordedDB, videoUtil, readerFactory),
        reader,
        readerFactory,
        videoUtil,
    };
};

const unavailable = { bitRate: Number.NaN, duration: Number.NaN, size: Number.NaN };

describe('動画情報を取得できない録画ファイルの直接配信 (unittest/imp)', () => {
    it('[MD-2.2] lease consumer は動画情報の許可を open へ渡し、指定が無いときは open の引数を増やさない', async () => {
        const source = {
            inputPath: 'synthetic/recording.ts',
            kind: 'encoded-direct',
            playPosition: 0,
            recordedId: 41,
            videoFileId: 31,
            videoInfo: unavailable,
        };
        const provider = {
            open: vi.fn(async () => ({ adopt: () => ({ source, status: 'adopted' }) })),
            resolveRecordedId: vi.fn(async () => 41),
        };
        const usePort = { acquire: vi.fn(async () => ({ release: vi.fn(async () => undefined) })) };
        const consumer = new RecordedDeliveryLeaseConsumer(provider, usePort);

        await consumer.acquireAndOpen(31, 0, () => true, { allowMissingVideoInfo: true });
        await consumer.acquireAndOpen(31, 0);

        expect(provider.open.mock.calls).toEqual([
            [31, 41, 0, { allowMissingVideoInfo: true }],
            [31, 41, 0],
        ]);
    });

    it.each([
        { isRecording: false, kind: 'completed-file-reader', method: 'openCompletedFile' },
        { isRecording: true, kind: 'recording-tail-reader', method: 'openRecordingTail' },
    ])(
        '[MD-2.2] 再生位置 0 は ffprobe が失敗しても先頭から読む $kind を返す',
        async ({ isRecording, kind, method }) => {
            const fixture = makeProvider('ts', isRecording);

            const opened = await fixture.provider.open(31, 41, 0, { allowMissingVideoInfo: true });

            expect(fixture.readerFactory[method as 'openCompletedFile']).toHaveBeenCalledExactlyOnceWith(
                '/synthetic/secret/recording.ts',
                0,
            );
            expect(opened.adopt()).toEqual({
                source: {
                    inputPath: '/synthetic/secret/recording.ts',
                    kind,
                    playPosition: 0,
                    reader: fixture.reader,
                    recordedId: 41,
                    videoFileId: 31,
                    videoInfo: unavailable,
                },
                status: 'adopted',
            });
        },
    );

    it('[MD-2.2] encode 済みは ffprobe が失敗しても直接配信の source を返す', async () => {
        const fixture = makeProvider('encoded', false);

        const opened = await fixture.provider.open(31, 41, 0, { allowMissingVideoInfo: true });

        expect(opened.adopt()).toMatchObject({
            source: { kind: 'encoded-direct', videoInfo: unavailable },
            status: 'adopted',
        });
    });

    it('[MD-2.2] 再生位置が 0 を超えるときは、ffprobe の文言を出さず RecordedPlaybackStartPositionUnavailable で失敗する', async () => {
        const fixture = makeProvider('ts', false);

        await expect(fixture.provider.open(31, 41, 0.5, { allowMissingVideoInfo: true })).rejects.toThrow(
            new Error('RecordedPlaybackStartPositionUnavailable'),
        );
        expect(fixture.readerFactory.openCompletedFile).not.toHaveBeenCalled();
        expect(fixture.readerFactory.openRecordingTail).not.toHaveBeenCalled();
    });

    it.each([{ option: undefined }, { option: {} }, { option: { allowMissingVideoInfo: false } }])(
        '[MD-2.2] 許可が無いとき（視聴用変換）は ffprobe の失敗をそのまま失敗にする: $option',
        async ({ option }) => {
            const fixture = makeProvider('ts', false);

            await expect(fixture.provider.open(31, 41, 0, option)).rejects.toThrow(ffprobeFailure);
            expect(fixture.readerFactory.openCompletedFile).not.toHaveBeenCalled();
        },
    );
});
