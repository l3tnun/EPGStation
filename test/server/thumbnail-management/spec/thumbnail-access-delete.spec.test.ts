import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupHarness, FileUtil, makeModel, restoreSpawn, ThumbnailApiModel } from '../imp/_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('thumbnail access and deletion characterization', () => {
    it('[TM-3.1] resolves a registered thumbnail to the configured filesystem path', async () => {
        const fixture = makeModel();
        fixture.thumbnailDB.findId.mockResolvedValue({ id: 71, filePath: 'synthetic-71.jpg', recordedId: 701 });
        const api = new ThumbnailApiModel({ thumbnail: {} }, fixture.thumbnailDB, { getConfig: () => fixture.config });

        await expect(api.getIdFilePath(71)).resolves.toBe('synthetic-thumbnail-root/synthetic-71.jpg');
    });

    it('[TM-3.2] returns null for access and rejects deletion when registration is absent', async () => {
        const fixture = makeModel();
        const api = new ThumbnailApiModel({ thumbnail: {} }, fixture.thumbnailDB, { getConfig: () => fixture.config });

        await expect(api.getIdFilePath(72)).resolves.toBeNull();
        await expect(fixture.model.delete(72)).rejects.toThrow('ThumbnailIsNotFound');
        expect(fixture.thumbnailDB.deleteOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitDeleted).not.toHaveBeenCalled();
    });

    it('[TM-3.4] emits deletion completion once after the registration and JPEG both succeed', async () => {
        const fixture = makeModel();
        const order: string[] = [];
        fixture.thumbnailDB.findId.mockResolvedValue({ id: 73, filePath: 'synthetic-73.jpg', recordedId: 703 });
        fixture.thumbnailDB.deleteOnce.mockImplementation(async () => {
            order.push('db');
        });
        vi.spyOn(FileUtil, 'unlink').mockImplementation(async () => {
            order.push('file');
        });
        fixture.thumbnailEvent.emitDeleted.mockImplementation(() => order.push('event'));

        await expect(fixture.model.delete(73)).resolves.toBeUndefined();

        expect(order).toEqual(['db', 'file', 'event']);
        expect(FileUtil.unlink).toHaveBeenCalledWith('synthetic-thumbnail-root/synthetic-73.jpg');
        expect(fixture.thumbnailEvent.emitDeleted).toHaveBeenCalledTimes(1);
    });

    it('[TM-3.3] attempts registration deletion before unlinking the corresponding JPEG', async () => {
        const fixture = makeModel();
        const failure = new Error('synthetic-db-delete-failure');
        fixture.thumbnailDB.findId.mockResolvedValue({ id: 731, filePath: 'synthetic-731.jpg', recordedId: 703 });
        fixture.thumbnailDB.deleteOnce.mockRejectedValue(failure);
        vi.spyOn(FileUtil, 'unlink').mockResolvedValue(undefined);

        await expect(fixture.model.delete(731)).rejects.toBe(failure);

        expect(FileUtil.unlink).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitDeleted).not.toHaveBeenCalled();
    });

    it('[TM-3.5] rejects an unlink failure without restoring the DB registration or notifying', async () => {
        const fixture = makeModel();
        const failure = new Error('synthetic-unlink-failure');
        const rows = new Map([[74, { id: 74, filePath: 'synthetic-74.jpg', recordedId: 704 }]]);
        const ledger: string[] = [];
        fixture.thumbnailDB.findId.mockImplementation(async id => rows.get(id) ?? null);
        fixture.thumbnailDB.deleteOnce.mockImplementation(async id => {
            ledger.push(`delete:${id}`);
            rows.delete(id);
        });
        vi.spyOn(FileUtil, 'unlink').mockRejectedValue(failure);

        await expect(fixture.model.delete(74)).rejects.toBe(failure);

        expect(ledger).toEqual(['delete:74']);
        expect(rows.size).toBe(0);
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitDeleted).not.toHaveBeenCalled();
    });
});
