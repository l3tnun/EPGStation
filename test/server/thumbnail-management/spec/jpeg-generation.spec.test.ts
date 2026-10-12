import * as fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../../harness/async';
import {
    cleanupHarness,
    FileUtil,
    makeChild,
    makeModel,
    prepareCreate,
    processStubs,
    ProcessUtil,
    restoreSpawn,
    settleChild,
    useRealSpawn,
} from '../imp/_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('thumbnail JPEG generation characterization', () => {
    it('[TM-2.7] keeps an existing standard JPEG and stores a newly generated numbered JPEG', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-spec-'));
        try {
            const standardPath = join(root, '101.jpg');
            const numberedPath = join(root, '101(1).jpg');
            await writeFile(standardPath, 'existing-jpeg');
            const fixture = makeModel({ config: { thumbnail: root } });
            const child = makeChild();
            processStubs.spawn.mockReturnValue(child);
            const actualOpen = fs.promises.open;
            let standardAttempts = 0;
            vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
                const [candidate] = args;
                if (candidate === root) {
                    throw Object.assign(new Error('synthetic-empty-output-name'), { code: 'EACCES' });
                }
                if (candidate === standardPath) {
                    standardAttempts++;
                    throw Object.assign(new Error('synthetic-output-conflict'), {
                        code: standardAttempts === 1 ? 'EEXIST' : 'EACCES',
                    });
                }
                return actualOpen(...args);
            });

            fixture.model.add(600);
            await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
            expect(fs.promises.open).toHaveBeenNthCalledWith(1, standardPath, 'wx');
            expect(fs.promises.open).toHaveBeenNthCalledWith(2, numberedPath, 'wx');
            const args = processStubs.spawn.mock.calls[0][1] as string[];
            await writeFile(args[args.indexOf('--output') + 1]!, 'generated-jpeg');
            settleChild(child, 0);
            await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());

            expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledWith(
                expect.objectContaining({ filePath: '101(1).jpg', recordedId: 101 }),
            );
            await expect(readFile(standardPath, 'utf8')).resolves.toBe('existing-jpeg');
            await expect(readFile(numberedPath, 'utf8')).resolves.toBe('generated-jpeg');
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    // The 29_999/30_000/30_001ms boundaries here and in [TM-2.3] below exercise
    // ThumbnailManageModel.PREPARATION_TIMEOUT_MS = 30_000
    // (src/model/operator/thumbnail/ThumbnailManageModel.ts:54), a v3-only absolute preparation
    // deadline with no v2 counterpart -- approved in
    // .kiro/specs/server-thumbnail-management/design.md:225,605 (TM-2.2).
    it('[TM-2.2] accepts preparation completed at 29,999ms and starts JPEG generation once', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        prepareCreate();
        const fixture = makeModel();
        const resolvedPath = createDeferred<string | null>();
        const child = makeChild();
        fixture.videoUtil.getFullFilePathFromId.mockReturnValueOnce(resolvedPath.promise);
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(621);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(processStubs.spawn).not.toHaveBeenCalled();

        resolvedPath.resolve('synthetic-input.ts');
        await vi.advanceTimersByTimeAsync(0);
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        settleChild(child, 0);
        await vi.advanceTimersByTimeAsync(0);
        expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce();
        expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledOnce();
    });

    it('[TM-2.3] fails preparation at and after its deadline, advances the queue, and fences a late result', async () => {
        for (const elapsed of [30_000, 30_001]) {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            prepareCreate();
            const fixture = makeModel();
            const lateVideo = createDeferred<{ id: number; recordedId: number } | null>();
            fixture.videoFileDB.findId.mockReturnValueOnce(lateVideo.promise).mockResolvedValueOnce(null);

            fixture.model.add(622);
            fixture.model.add(623);
            await vi.advanceTimersByTimeAsync(elapsed);

            expect(fixture.videoFileDB.findId).toHaveBeenCalledTimes(2);
            expect(processStubs.spawn).not.toHaveBeenCalled();
            expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

            lateVideo.resolve({ id: 622, recordedId: 101 });
            await vi.advanceTimersByTimeAsync(0);

            expect(fixture.videoUtil.getFullFilePathFromId).toHaveBeenCalledOnce();
            expect(fixture.videoUtil.getFullFilePathFromId).toHaveBeenCalledWith(623);
            expect(fixture.videoUtil.getFullFilePathFromId).not.toHaveBeenCalledWith(622);
            expect(processStubs.spawn).not.toHaveBeenCalled();
            expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            cleanupHarness();
        }
    });

    it('[TM-2.1] rejects absent video registration or resolved path before filesystem and process boundaries', async () => {
        const missingRow = makeModel();
        missingRow.videoFileDB.findId.mockResolvedValue(null);
        missingRow.model.add(601);
        await vi.waitFor(() =>
            expect(missingRow.log.system.error).toHaveBeenCalledWith('video file is not found: 601'),
        );

        const missingPath = makeModel();
        missingPath.videoUtil.getFullFilePathFromId.mockResolvedValue(null);
        missingPath.model.add(602);
        await vi.waitFor(() =>
            expect(missingPath.log.system.error).toHaveBeenCalledWith('video file is not found: 602'),
        );

        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(missingRow.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(missingPath.thumbnailDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[TM-2.6] resolves the video and passes its configured position, size, and generation method to spawn', async () => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(61);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        expect(fixture.videoFileDB.findId).toHaveBeenCalledWith(61);
        expect(fixture.videoUtil.getFullFilePathFromId).toHaveBeenCalledWith(61);
        expect(processStubs.spawn).toHaveBeenCalledWith(process.execPath, [
            '--input',
            'synthetic-input.ts',
            '--output',
            'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            '--position',
            '17',
            '--size',
            '320x180',
        ]);

        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(1));
    });

    it('[TM-2.4] creates a missing thumbnail directory before spawning', async () => {
        prepareCreate();
        vi.mocked(FileUtil.access).mockRejectedValueOnce(
            Object.assign(new Error('synthetic-missing'), { code: 'ENOENT' }),
        );
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(62);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        expect(FileUtil.mkdir).toHaveBeenCalledWith('synthetic-thumbnail-root');
        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(1));
    });

    it('[TM-2.5] does not spawn when the thumbnail directory is inaccessible', async () => {
        prepareCreate();
        const denial = Object.assign(new Error('synthetic-permission-denied'), { code: 'EACCES' });
        vi.mocked(FileUtil.access).mockRejectedValueOnce(denial);
        const fixture = makeModel();

        fixture.model.add(63);
        await vi.waitFor(() => expect(fixture.log.system.fatal).toHaveBeenCalled());

        expect(processStubs.spawn).not.toHaveBeenCalled();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-2.10] persists the generated relative JPEG path and recorded ID after a zero exit', async () => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(64);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledTimes(1));

        expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: '101.jpg', recordedId: 101 }),
        );
        expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(64, 101);
    });

    it('[TM-2.11] emits generation completion only after thumbnail registration has settled', async () => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        const pendingInsert = createDeferred<number>();
        fixture.thumbnailDB.insertOnce.mockReturnValueOnce(pendingInsert.promise);
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(640);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

        pendingInsert.resolve(101);
        await vi.waitFor(() => expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(640, 101));
    });

    it('[TM-2.8] applies the positive finite generation deadline before, at, and after 300 seconds', async () => {
        for (const elapsed of [299_999, 300_000, 300_001]) {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            const stop = vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
            prepareCreate();
            const fixture = makeModel();
            const child = makeChild();
            processStubs.spawn.mockReturnValue(child);

            fixture.model.add(641);
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(elapsed);
            settleChild(child, 0);
            await vi.advanceTimersByTimeAsync(0);

            if (elapsed < 300_000) {
                expect(stop).not.toHaveBeenCalled();
                expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce();
                expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledOnce();
                cleanupHarness();
                continue;
            }

            expect(stop).toHaveBeenCalledOnce();
            expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            cleanupHarness();
        }
    });

    it('[TM-2.9] holds the child lease after deadline failure until the child closes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const stop = vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
        prepareCreate();
        const fixture = makeModel();
        const expired = makeChild();
        const next = makeChild();
        processStubs.spawn.mockReturnValueOnce(expired).mockReturnValueOnce(next);

        fixture.model.add(642);
        fixture.model.add(643);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(300_000);

        expect(stop).toHaveBeenCalledOnce();
        expect(processStubs.spawn).toHaveBeenCalledOnce();
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

        expired.emit('close', 7);
        await vi.advanceTimersByTimeAsync(0);
        expect(processStubs.spawn).toHaveBeenCalledTimes(2);
    });

    it('[TM-2.12] removes only the owned temporary and reserved final JPEG after a nonzero exit', async () => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(65);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        settleChild(child, 7);
        await vi.waitFor(() => expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail cmd error: 7'));
        await vi.waitFor(() => expect(FileUtil.unlink).toHaveBeenCalledTimes(2));

        expect(FileUtil.unlink).toHaveBeenNthCalledWith(1, 'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg');
        expect(FileUtil.unlink).toHaveBeenNthCalledWith(2, 'synthetic-thumbnail-root/101.jpg');
        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
    });

    it('[TM-2.13] separates the configured command executable from its substituted arguments', async () => {
        prepareCreate();
        const fixture = makeModel();
        const child = makeChild();
        processStubs.spawn.mockReturnValue(child);

        fixture.model.add(643);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledOnce());
        expect(processStubs.spawn).toHaveBeenCalledWith(process.execPath, [
            '--input',
            'synthetic-input.ts',
            '--output',
            'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
            '--position',
            '17',
            '--size',
            '320x180',
        ]);

        settleChild(child, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
    });

    it('[TM-2.14] passes a synthetic parent marker to the actual child process', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-env-'));
        const script = join(root, 'synthetic-child.cjs');
        const markerName = 'EPGSTATION_SYNTHETIC_PARENT_MARKER';
        const previousMarker = process.env[markerName];
        try {
            await writeFile(
                script,
                // The `.cjs` extension deliberately forces CommonJS for this spawned script
                // regardless of the parent project's `"type": "module"`, so it must use
                // `require`, not a static `import` (an unrelated ESM-migration edit briefly
                // replaced this with `import fs from 'node:fs'`, which is a SyntaxError under
                // CommonJS and made the spawned child exit before writing the output file).
                `const fs = require('node:fs'); const output = process.argv[2]; if (process.env.${markerName} !== 'synthetic-visible') process.exit(9); fs.writeFileSync(output, 'synthetic-jpeg');`,
                'utf8',
            );
            process.env[markerName] = 'synthetic-visible';
            useRealSpawn();
            const fixture = makeModel({
                config: { thumbnail: root, thumbnailCmd: `%FFMPEG% ${script} %OUTPUT%` },
            });

            fixture.model.add(644);
            await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce(), { timeout: 5_000 });

            expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(644, 101);
            await expect(readFile(join(root, '101.jpg'), 'utf8')).resolves.toBe('synthetic-jpeg');
        } finally {
            if (previousMarker === undefined) delete process.env[markerName];
            else process.env[markerName] = previousMarker;
            await rm(root, { recursive: true, force: true });
        }
    });
});
