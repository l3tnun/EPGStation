import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger, RecordingManageModel } from './_harness';

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordingManageModel.setTuner thin delegation (L408–410).
 * Public setTuner forwards the same tuners array to streamCreator.setTuner exactly once.
 */
const makeManager = () => {
    const setTuner = vi.fn();
    const manager = new RecordingManageModel(
        { getLogger: () => logger },
        { getConfig: () => ({ recordedTmp: '/synthetic-tmp' }) },
        vi.fn(async () => ({})),
        {
            setCancelPrepRecording: vi.fn(),
            setEventRelay: vi.fn(),
            setFinishRecording: vi.fn(),
            setPrepRecordingFailed: vi.fn(),
            setRecordingFailed: vi.fn(),
            setRecordingRetryOver: vi.fn(),
            setStartPrepRecording: vi.fn(),
            setStartRecording: vi.fn(),
        },
        { setTuner },
        {
            findAll: vi.fn(async () => [[], 0]),
            findId: vi.fn(async () => null),
            findReserveId: vi.fn(async () => []),
            removeRecording: vi.fn(async () => undefined),
        },
        { findId: vi.fn(async () => null), findLists: vi.fn(async () => []) },
        {
            movingFromTmp: vi.fn(async () => '/synthetic/out.ts'),
            updateVideoFileSize: vi.fn(async () => undefined),
        },
    );
    return { manager, setTuner };
};

describe('RecordingManageModel.setTuner delegation (unittest/imp)', () => {
    it('[R2-SETTUNER-DELEGATION] public setTuner forwards the same tuners to streamCreator once', () => {
        const { manager, setTuner } = makeManager();
        const tuners = [{ types: ['GR'] as const }, { types: ['BS'] as const }];

        manager.setTuner(tuners);

        expect(setTuner).toHaveBeenCalledExactlyOnceWith(tuners);
        expect(setTuner.mock.calls[0]?.[0]).toBe(tuners);
    });
});
