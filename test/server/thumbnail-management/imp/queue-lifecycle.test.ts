import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createCallLedger, createDeferred } from '../../harness/async';
import {
    cleanupHarness,
    FileUtil,
    logger,
    makeChild,
    makeModel,
    prepareCreate,
    processStubs,
    restoreSpawn,
    settleChild,
    ThumbnailEvent,
    useRealSpawn,
} from './_thumbnail-harness';

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('waiting-generating-success-failure-reentry-and-db-pending thumbnail queue and process lifecycle characterization', () => {
    it('[TM-IMP-QUEUE-DB-PENDING] does not start the next process until the first DB insert settles', async () => {
        prepareCreate();
        const fixture = makeModel();
        const firstChild = makeChild();
        const secondChild = makeChild();
        const firstInsert = createDeferred<number>();
        processStubs.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
        fixture.thumbnailDB.insertOnce.mockReturnValueOnce(firstInsert.promise).mockResolvedValueOnce(2);

        fixture.model.add(111);
        fixture.model.add(112);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        settleChild(firstChild, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(1));
        expect(processStubs.spawn).toHaveBeenCalledTimes(1);

        firstInsert.resolve(1);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        settleChild(secondChild, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
    });

    it('[TM-IMP-QUEUE-LISTENER] starts the next process after emit without waiting for an async listener', async () => {
        prepareCreate();
        const fixture = makeModel();
        const event = new ThumbnailEvent({ getLogger: () => logger() });
        const listener = createDeferred<void>();
        const firstInsert = createDeferred<number>();
        const ledger = createCallLedger<string>();
        const callback = vi.fn(() => {
            ledger.record('notification callback');
            return listener.promise;
        });
        event.setAdded(callback);
        fixture.model.thumbnailEvent = event;
        const firstChild = makeChild();
        const secondChild = makeChild();
        fixture.thumbnailDB.insertOnce.mockImplementationOnce(() =>
            firstInsert.promise.then(result => {
                ledger.record('DB settle');
                return result;
            }),
        );
        processStubs.spawn.mockReturnValueOnce(firstChild).mockImplementationOnce(() => {
            ledger.record('second spawn');
            return secondChild;
        });

        fixture.model.add(121);
        fixture.model.add(122);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        settleChild(firstChild, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(1));
        expect(ledger.entries()).toEqual([]);

        firstInsert.resolve(1);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        expect(ledger.entries().map(entry => entry.value)).toEqual([
            'DB settle',
            'notification callback',
            'second spawn',
        ]);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(listener.state()).toEqual({ status: 'pending' });

        listener.resolve(undefined);
        await listener.promise;
        settleChild(secondChild, 0);
        await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
    });

    it.each([undefined, 'ENOENT'])(
        '[TM-IMP-COMMIT-FAILURE] records a DB failure, classifies temporary cleanup errno %s, and then advances the queue',
        async errno => {
            prepareCreate();
            const fixture = makeModel();
            const firstChild = makeChild();
            const secondChild = makeChild();
            const failure = new Error('synthetic-db-insert-failure');
            processStubs.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
            const cleanupFailure = Object.assign(new Error('synthetic-output-cleanup-failure'), { code: errno });
            fixture.thumbnailDB.insertOnce.mockRejectedValueOnce(failure).mockResolvedValueOnce(2);
            vi.mocked(FileUtil.unlink).mockRejectedValueOnce(cleanupFailure).mockResolvedValueOnce(undefined);

            fixture.model.add(131);
            fixture.model.add(132);
            await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
            settleChild(firstChild, 0);
            await vi.waitFor(() =>
                expect(FileUtil.unlink).toHaveBeenCalledWith(
                    'synthetic-thumbnail-root/.thumbnail-request/thumbnail.jpg',
                ),
            );
            expect(FileUtil.unlink).toHaveBeenCalledWith('synthetic-thumbnail-root/101.jpg');
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            expect(fixture.log.system.error).toHaveBeenCalledWith(
                'thumbnail database failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1',
            );
            expect(fixture.log.system.error).toHaveBeenCalledWith(failure);
            const cleanupContext =
                'thumbnail cleanup temporary file failed: requestId=thumbnail-request-1, reservationId=thumbnail-reservation-1';
            if (errno === 'ENOENT') {
                expect(fixture.log.system.error).not.toHaveBeenCalledWith(cleanupContext);
                expect(fixture.log.system.error).not.toHaveBeenCalledWith(cleanupFailure);
            } else {
                expect(fixture.log.system.error).toHaveBeenCalledWith(cleanupContext);
                expect(fixture.log.system.error).toHaveBeenCalledWith(cleanupFailure);
            }
            await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));

            settleChild(secondChild, 0);
            await vi.waitFor(() => expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledOnce());
        },
    );

    it('[TM-IMP-SPAWN-ERROR] records spawn error and keeps the next child blocked until close', async () => {
        prepareCreate();
        const fixture = makeModel();
        const firstChild = makeChild();
        const secondChild = makeChild();
        const failure = new Error('synthetic-spawn-error');
        processStubs.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

        fixture.model.add(135);
        fixture.model.add(136);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(1));
        firstChild.emit('error', failure);
        await vi.waitFor(() => expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail failed: 135'));

        await new Promise<void>(resolve => setImmediate(resolve));
        expect(processStubs.spawn).toHaveBeenCalledOnce();

        expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();

        firstChild.emit('close', null);
        await vi.waitFor(() => expect(processStubs.spawn).toHaveBeenCalledTimes(2));
        settleChild(secondChild, 0);
        await vi.waitFor(() => expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(136, 101));
    });

    it('[TM-CHAR-R2.14] observes Node 24 parent-environment inheritance through the actual spawn call', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-env-'));
        const script = join(root, 'synthetic-child.cjs');
        const markerName = 'EPGSTATION_SYNTHETIC_PARENT_MARKER';
        const previousMarker = process.env[markerName];
        try {
            await writeFile(
                script,
                `const fs = require('node:fs'); const output = process.argv[2]; if (process.env.${markerName} !== 'synthetic-visible') process.exit(9); fs.writeFileSync(output, 'synthetic-jpeg');`,
                'utf8',
            );
            process.env[markerName] = 'synthetic-visible';
            useRealSpawn();
            const fixture = makeModel({
                config: { thumbnail: root, thumbnailCmd: `%FFMPEG% ${script} %OUTPUT%` },
            });

            fixture.model.add(141);
            await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce(), { timeout: 5_000 });

            expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(141, 101);
            await expect(readFile(join(root, '101.jpg'), 'utf8')).resolves.toBe('synthetic-jpeg');
        } finally {
            if (previousMarker === undefined) delete process.env[markerName];
            else process.env[markerName] = previousMarker;
            await rm(root, { recursive: true, force: true });
        }
    });
});
