import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupHarness, FileUtil, makeModel, restoreSpawn } from '../imp/_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('thumbnail regeneration characterization', () => {
    it('[TM-4.1] skips records without video files without deleting or admitting anything', async () => {
        const fixture = makeModel();
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                { id: 800, thumbnails: [], videoFiles: [] },
                { id: 801, thumbnails: [{ id: 80, filePath: 'synthetic-unused.jpg' }] },
            ],
            2,
        ]);
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.thumbnailDB.deleteOnce).not.toHaveBeenCalled();
        expect(fixture.model.add).not.toHaveBeenCalled();
    });

    it('[TM-4.3] admits the first recorded video when no usable thumbnail remains', async () => {
        const fixture = makeModel();
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                {
                    id: 801,
                    thumbnails: [{ id: 81, filePath: 'synthetic-missing.jpg' }],
                    videoFiles: [{ id: 811 }, { id: 812 }],
                },
            ],
            1,
        ]);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(new Error('synthetic-missing'));
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledWith(81);
        expect(fixture.model.add).toHaveBeenCalledOnce();
        expect(fixture.model.add).toHaveBeenCalledWith(811);
    });

    it('[TM-4.4] admits no generation when at least one registered JPEG exists', async () => {
        const fixture = makeModel();
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                {
                    id: 802,
                    thumbnails: [
                        { id: 82, filePath: 'synthetic-present.jpg' },
                        { id: 83, filePath: 'synthetic-missing.jpg' },
                    ],
                    videoFiles: [{ id: 821 }],
                },
            ],
            1,
        ]);
        vi.spyOn(FileUtil, 'stat').mockImplementation(async (file: unknown) => {
            if (String(file).endsWith('synthetic-present.jpg')) return {};
            throw new Error('synthetic-missing');
        });
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenCalledWith(83);
        expect(fixture.model.add).not.toHaveBeenCalled();
    });

    it('[TM-4.2] attempts deletion of a registration whose JPEG is missing', async () => {
        const fixture = makeModel();
        const deletionFailure = new Error('synthetic-missing-row-delete-failure');
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                {
                    id: 8021,
                    thumbnails: [{ id: 821, filePath: 'synthetic-missing-first.jpg' }],
                    videoFiles: [{ id: 8211 }],
                },
                {
                    id: 8022,
                    thumbnails: [{ id: 822, filePath: 'synthetic-missing-second.jpg' }],
                    videoFiles: [{ id: 8221 }],
                },
            ],
            2,
        ]);
        fixture.thumbnailDB.deleteOnce.mockRejectedValueOnce(deletionFailure).mockResolvedValueOnce(undefined);
        vi.spyOn(FileUtil, 'stat').mockRejectedValue(new Error('synthetic-missing'));
        fixture.model.add = vi.fn();

        await fixture.model.regenerate();

        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenNthCalledWith(1, 821);
        expect(fixture.thumbnailDB.deleteOnce).toHaveBeenNthCalledWith(2, 822);
        expect(fixture.model.add.mock.calls).toEqual([[8211], [8221]]);
        expect(fixture.log.system.error).toHaveBeenCalledWith(deletionFailure);
    });

    it('[TM-4.5] resolves after admission without waiting for queued JPEG generation', async () => {
        const fixture = makeModel();
        fixture.recordedDB.findAll.mockResolvedValue([[{ id: 803, thumbnails: [], videoFiles: [{ id: 831 }] }], 1]);
        fixture.model.add = vi.fn();

        await expect(fixture.model.regenerate()).resolves.toBeUndefined();

        expect(fixture.model.add).toHaveBeenCalledWith(831);
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[TM-4.6] logs one synchronous admission failure and continues to a later target', async () => {
        const fixture = makeModel();
        const failure = new Error('synthetic-admission-failure');
        fixture.model.add = vi
            .fn()
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw failure;
            })
            .mockImplementationOnce(() => undefined);
        fixture.recordedDB.findAll.mockResolvedValue([
            [
                { id: 803, thumbnails: [], videoFiles: [{ id: 831 }] },
                { id: 804, thumbnails: [], videoFiles: [{ id: 841 }] },
                { id: 805, thumbnails: [], videoFiles: [{ id: 851 }] },
            ],
            3,
        ]);

        await expect(fixture.model.regenerate()).resolves.toBeUndefined();

        expect(fixture.model.add.mock.calls).toEqual([[831], [841], [851]]);
        expect(fixture.log.system.error).toHaveBeenCalledWith(
            'failed to add regenerated thumbnail: recordedId=804, videoFileId=841',
        );
        expect(
            fixture.log.system.error.mock.calls.filter(
                ([value]) => value === 'failed to add regenerated thumbnail: recordedId=804, videoFileId=841',
            ),
        ).toHaveLength(1);
        expect(fixture.log.system.error).toHaveBeenCalledWith(failure);
        expect(fixture.log.system.error.mock.calls.filter(([value]) => value === failure)).toHaveLength(1);
    });
});
