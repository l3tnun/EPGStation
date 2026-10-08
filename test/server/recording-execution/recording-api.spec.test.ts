import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';
import { load, Recorded } from './_harness';

const RecordingApiModel = load<new (...args: any[]) => any>('model', 'api', 'recording', 'RecordingApiModel.js');

describe('recording api gets/resetTimer characterization', () => {
    it('[Task 1.5] forces isRecording, transfers the fixed column-option flags, and maps records with isHalfWidth', async () => {
        const recordedRow = Object.assign(new Recorded(), { id: 961 });
        const findAllCalls: Array<{ option: unknown; columnOption: unknown }> = [];
        const recordedDB = {
            findAll: vi.fn(async (option: any, columnOption: any) => {
                findAllCalls.push({ option: { ...option }, columnOption: { ...columnOption } });
                return [[recordedRow], 1];
            }),
        };
        const converted = { id: 961, name: 'synthetic-converted-961' };
        const recordedItemUtil = {
            convertRecordedToRecordedItem: vi.fn((recorded: unknown, isHalfWidth: unknown) => {
                expect(recorded).toBe(recordedRow);
                expect(isHalfWidth).toBe(true);
                return converted;
            }),
        };
        const api = new RecordingApiModel({ recording: { resetTimer: vi.fn() } }, recordedDB, recordedItemUtil);

        const option: any = { isHalfWidth: true, isRecording: false };
        const result = await api.gets(option);

        expect(option.isRecording).toBe(true);
        expect(findAllCalls).toEqual([
            {
                option: { isHalfWidth: true, isRecording: true },
                columnOption: {
                    isNeedVideoFiles: true,
                    isNeedThumbnails: true,
                    isNeedsDropLog: false,
                    isNeedTags: false,
                },
            },
        ]);
        expect(recordedItemUtil.convertRecordedToRecordedItem).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ records: [converted], total: 1 });
    });

    it('[Task 1.5] propagates a recordedDB.findAll rejection and an ipc.recording.resetTimer rejection unconverted', async () => {
        const dbFailure = new Error('synthetic-recordedDB-findAll-failure');
        const apiForDbFailure = new RecordingApiModel(
            { recording: { resetTimer: vi.fn() } },
            { findAll: vi.fn().mockRejectedValue(dbFailure) },
            { convertRecordedToRecordedItem: vi.fn() },
        );

        await expect(apiForDbFailure.gets({ isRecording: false } as any)).rejects.toBe(dbFailure);

        const ipcFailure = new Error('synthetic-ipc-resetTimer-failure');
        const apiForIpcFailure = new RecordingApiModel(
            { recording: { resetTimer: vi.fn().mockRejectedValue(ipcFailure) } },
            { findAll: vi.fn() },
            { convertRecordedToRecordedItem: vi.fn() },
        );

        await expect(apiForIpcFailure.resetTimer()).rejects.toBe(ipcFailure);
    });

    it('[Task 1.5] resolves once the ipc.recording.resetTimer call settles successfully', async () => {
        const resetTimer = vi.fn().mockResolvedValue(undefined);
        const api = new RecordingApiModel(
            { recording: { resetTimer } },
            { findAll: vi.fn() },
            { convertRecordedToRecordedItem: vi.fn() },
        );

        await expect(api.resetTimer()).resolves.toBeUndefined();
        expect(resetTimer).toHaveBeenCalledOnce();
    });
});
