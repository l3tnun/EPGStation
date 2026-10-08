import { describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';

const StreamApiModel = compiled<any>('model', 'api', 'stream', 'StreamApiModel.js').default;

const makeModel = (config: Record<string, unknown>, streamManageModel: Record<string, unknown> = {}) =>
    new StreamApiModel(
        { getConfig: () => config },
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        streamManageModel,
        {},
        {},
        {},
        {},
        {},
    );

/**
 * StreamApiModel の encode 済み録画向け config の取り出しと、stream id 指定の停止。
 * encode 済み file の再生元には `stream.recorded.encoded` の設定が必要で、
 * 無ければ `ConfigIsUndefined` で開始を拒む。
 */
describe('StreamApiModel encoded recorded config and stop (unittest/imp)', () => {
    it.each([
        ['encoded', { stream: { recorded: { ts: { webm: [{ cmd: 'ts-cmd' }] } } } }],
        ['encoded type', { stream: { recorded: { encoded: { mp4: [{ cmd: 'mp4-cmd' }] }, ts: {} } } }],
        ['encoded mode', { stream: { recorded: { encoded: { webm: [] } } } }],
    ])('[MD-9.1] getRecordedVideoConfig rejects ConfigIsUndefined when %s is not configured', (_name, config) => {
        const model = makeModel(config);

        expect(() => model.getRecordedVideoConfig('webm', 0, true)).toThrow('ConfigIsUndefined');
    });

    it('[MD-2.2] getRecordedVideoConfig returns the encoded command for an encode-direct source', () => {
        const model = makeModel({
            stream: { recorded: { encoded: { webm: [{ cmd: 'encoded-cmd' }] }, ts: { webm: [{ cmd: 'ts-cmd' }] } } },
        });

        expect(model.getRecordedVideoConfig('webm', 0, true)).toEqual({ cmd: 'encoded-cmd' });
    });

    it('[MD-4.3] stop forwards the stream id and the force flag to the stream manager', async () => {
        const stop = vi.fn().mockResolvedValue(undefined);
        const model = makeModel({}, { stop });

        await model.stop(7, true);
        await model.stop(8);

        expect(stop).toHaveBeenNthCalledWith(1, 7, true);
        expect(stop).toHaveBeenNthCalledWith(2, 8, false);
    });
});
