import 'reflect-metadata';

import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

/*
 * `file-type` は ESM のみで、compiled の VideoApiModel.js は静的 import するため、
 * `vi.doMock` + `vi.resetModules` + 動的 `import()` で束縛を差し替える
 * （videoapi-mimetypeerror.imp.test.ts と同じ手順）。
 */
const fileTypeFromFileDispatch = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined);

let VideoApiModel: new (...args: unknown[]) => {
    openDelivery(
        videoFileId: number,
        isActive?: () => boolean,
    ): Promise<{
        isTail: boolean;
        mime: string;
        path: string;
        reader: unknown;
        release(): Promise<void>;
    } | null>;
};

beforeAll(async () => {
    vi.doMock('file-type', () => ({ fileTypeFromFile: (...args: unknown[]) => fileTypeFromFileDispatch(...args) }));
    try {
        vi.resetModules();
        VideoApiModel = ((await import(join(snapshot, 'model', 'api', 'video', 'VideoApiModel.js'))) as any).default;
    } finally {
        vi.doUnmock('file-type');
    }
});

afterEach(() => {
    vi.resetAllMocks();
});

const reader = { readable: { synthetic: 'readable' } };

const makeSubject = (source: Record<string, unknown>) => {
    const deliveryRelease = vi.fn().mockResolvedValue(undefined);
    const acquireRecordedDelivery = vi.fn().mockResolvedValue({ release: deliveryRelease, source });
    const model = new VideoApiModel({}, {}, {}, {}, {}, {}, { acquireRecordedDelivery });
    return { acquireRecordedDelivery, deliveryRelease, model };
};

/**
 * VideoApiModel.openDelivery が、貸し出された再生元を配信用の形へ組み立てる分岐。
 * file-type が判定できればその mime、読み取り reader は encode 済み直接配信では持たず、
 * 組み立てに失敗したときは貸し出しを返してから失敗を伝える。
 */
describe('VideoApiModel.openDelivery delivery assembly (unittest/imp)', () => {
    it('[MD-10.2] uses the detected mime and exposes the tail reader for a recording-tail source', async () => {
        fileTypeFromFileDispatch.mockResolvedValue({ mime: 'video/mp4' });
        const { acquireRecordedDelivery, deliveryRelease, model } = makeSubject({
            inputPath: '/synthetic/recording.ts',
            kind: 'recording-tail-reader',
            reader,
        });

        const delivery = await model.openDelivery(51);

        expect(acquireRecordedDelivery).toHaveBeenCalledExactlyOnceWith(51, 0, expect.any(Function));
        expect(delivery).toMatchObject({
            isTail: true,
            mime: 'video/mp4',
            path: '/synthetic/recording.ts',
            reader,
        });
        expect(deliveryRelease).not.toHaveBeenCalled();
        await delivery!.release();
        expect(deliveryRelease).toHaveBeenCalledOnce();
    });

    it('[MD-10.2] gives an encoded-direct source no reader and no tail flag', async () => {
        fileTypeFromFileDispatch.mockResolvedValue({ mime: 'video/webm' });
        const { model } = makeSubject({ inputPath: '/synthetic/encoded.webm', kind: 'encoded-direct' });

        const delivery = await model.openDelivery(52);

        expect(delivery).toMatchObject({ isTail: false, mime: 'video/webm', path: '/synthetic/encoded.webm' });
        expect(delivery!.reader).toBeUndefined();
    });

    it('[MD-10.2] releases the lease and rejects RecordedDeliveryStopped when the request became inactive', async () => {
        fileTypeFromFileDispatch.mockResolvedValue({ mime: 'video/mp2t' });
        const { deliveryRelease, model } = makeSubject({
            inputPath: '/synthetic/completed.ts',
            kind: 'completed-file-reader',
            reader,
        });

        await expect(model.openDelivery(53, () => false)).rejects.toThrow('RecordedDeliveryStopped');

        expect(deliveryRelease).toHaveBeenCalledOnce();
    });

    it('[MD-10.2] releases the lease and rethrows when the mime cannot be determined', async () => {
        fileTypeFromFileDispatch.mockResolvedValue(undefined);
        const { deliveryRelease, model } = makeSubject({
            inputPath: '/synthetic/unknown.mp4',
            kind: 'completed-file-reader',
            reader,
        });

        await expect(model.openDelivery(54)).rejects.toThrow('MimeTypeError');

        expect(deliveryRelease).toHaveBeenCalledOnce();
    });
});
