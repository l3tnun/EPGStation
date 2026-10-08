import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanupHarness,
    makeModel,
    processStubs,
    ProcessUtil,
    restoreSpawn,
    ThumbnailManageModel,
    useRealSpawn,
} from '../imp/_thumbnail-harness';

// This budget bounds only the model's own internal, real setTimeout-driven scheduling (the
// generation deadline timer firing and calling `ProcessUtil.kill`) -- never a spawned child's own
// run time. A full real child spawn-run-cleanup cycle (fork+exec of a fresh Node process, script
// execution, exit, and reap) is bounded only by that child's own real `close` event below
// (`closeSignals` / `waitForChildClose`), never by a fixed wall-clock number: under host CPU
// contention that cycle can legitimately take far longer than any number chosen here could
// assume. Bundling such a cycle inside a fixed budget together with unrelated waits
// makes the assertion depending on it flaky (observed in CI: the file's own `insertOnce` count
// assertion timed out at this 2s budget while the identical run passed in ~895ms moments later on
// a quieter host).
const REAL_CHILD_WAIT_MS = 2_000;

afterEach(cleanupHarness);
afterAll(restoreSpawn);

describe('thumbnail child-process integration', () => {
    // This test drives five real child-process spawn-run-cleanup cycles in sequence plus one real
    // `ProcessUtil.kill` grace period (~500ms) -- real OS scheduling that Vitest's default 5000ms
    // testTimeout was never sized for under full-suite/host contention (the same class of cost
    // documented for other real-child-process tests in this codebase). Now that
    // every step gating on a specific child's own termination waits on that child's real `close`
    // event instead of a fixed budget (see `closeSignals` / `waitForChildClose` below), this
    // explicit, generous timeout is the only wall-clock bound left in the test.
    it('[TM-7.4-process] deadline-stop-failure-late-close-and-live-child-lease releases the successor only after real child terminal cleanup', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-thumbnail-process-'));
        // The `.cjs` extension deliberately forces CommonJS for this spawned script regardless of
        // the parent project's `"type": "module"`, so it must use `require`, not a static `import`
        // (an unrelated ESM-migration edit briefly replaced this with `import fs from 'node:fs'`,
        // which is a SyntaxError under CommonJS and made the spawned child exit before writing the
        // output file, before `stop`/`ProcessUtil.kill` was ever reached). See the sibling note at
        // `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`'s
        // `[TM-2.14] passes a synthetic parent marker to the actual child process`.
        const script = join(root, 'synthetic-thumbnail-child.cjs');
        const originalTimeout = ThumbnailManageModel.processTimeoutMs;
        const children: any[] = [];
        let primaryError: unknown;
        try {
            await writeFile(
                script,
                [
                    "const fs = require('node:fs');",
                    'const [input, output] = process.argv.slice(2);',
                    "if (input === 'slow-input.ts') setInterval(() => undefined, 1_000);",
                    "else if (input === 'failed-input.ts') process.exit(7);",
                    "else fs.writeFileSync(output, 'synthetic-jpeg');",
                ].join('\n'),
                'utf8',
            );
            // v2 logged `create thumbnail cmd error` for every nonzero exit and had no
            // deadline (5cf2ea383). v3's onClose checks `performance.now() >= deadline`
            // first and only the else-if logs the cmd error. One shared 50ms budget is
            // shorter than a real spawn, so the exit-7 child's close was classified as
            // the deadline (measured under server-node26: deadline/stop/cleanup logs,
            // never `create thumbnail cmd error: 7`). Only the two children that must
            // hit the deadline (901 and 905) stay short. 902, the exit-7 child, and
            // 906 get a budget their own close finishes inside, so a missing cmd-error
            // log on that path still fails this assertion. Call order matches
            // runGeneration: 901, 902, 903, 904 (spawn throws after the read), 905, 906.
            const generationTimeoutMs = [50, 30_000, 30_000, 30_000, 50, 30_000];
            let generation = 0;
            ThumbnailManageModel.processTimeoutMs = () => {
                const timeout = generationTimeoutMs[generation] ?? 30_000;
                generation += 1;
                return timeout;
            };
            const stopFailure = new Error('synthetic stop failure');
            const stop = vi.spyOn(ProcessUtil, 'kill').mockRejectedValueOnce(stopFailure);
            // `ThumbnailManageModel.js`'s compiled `import { spawn } from 'child_process'` binding
            // resolves once at module load to `processStubs.spawn` (see `_thumbnail-harness.ts`'s
            // `useRealSpawn` note); mutating the CommonJS `require('child_process').spawn` property
            // at test time (the approach `restoreSpawn` implements) does not reach it, so
            // the wrapper below is installed on `processStubs.spawn` directly instead.
            //
            // The real spawn function itself is obtained through `useRealSpawn()` rather than this
            // file's own `import ... from 'node:child_process'` (verified, not assumed): a static
            // ESM import of `node:child_process` in *this* file would run, in source order, before
            // the harness module's own `require('child_process').spawn = processStubs.spawn`
            // mutation below it -- becoming the very first ESM import of that builtin and locking
            // the shared ESM facade to the pre-mutation `spawn`. `ThumbnailManageModel.js`'s own
            // `import { spawn }` would then resolve to that same already-snapshotted real function
            // instead of `processStubs.spawn`, silently bypassing this wrapper (confirmed: with such
            // an import here, a real child was still spawned and reached its deadline/kill, but
            // `processStubs.spawn`'s mock implementation was never invoked). `useRealSpawn()` reads
            // the harness's own privately-captured original inside `_thumbnail-harness.ts`, where the
            // capture already happens in the correct order, so it carries no such risk.
            let spawnFailure: Error | null = null;
            useRealSpawn();
            const realSpawn = processStubs.spawn.getMockImplementation()!;
            // `closeSignals[i]` is captured synchronously in the same call stack as the real
            // `spawn()` call itself that produces `children[i]`, so there is no window in which a
            // fast-exiting child (e.g. `failed-input.ts`'s immediate `process.exit(7)`) could emit
            // its real `close` before this listener is attached -- unlike attaching a listener
            // after separately discovering the child exists (e.g. by polling `children.length`),
            // which would race the child's own termination.
            const closeSignals: Promise<void>[] = [];
            processStubs.spawn.mockImplementation((...args: Parameters<typeof realSpawn>) => {
                if (spawnFailure !== null) throw spawnFailure;
                const child = realSpawn(...args);
                children.push(child);
                closeSignals.push(once(child, 'close').then(() => undefined));
                return child;
            });
            // Waits for the real child at `children[index]` to actually terminate -- its own real
            // `close` event, not a wall-clock budget. The only timed step here is the small
            // `vi.waitFor` below, and it bounds nothing but "the queue reached this child's own
            // `spawn()` call": pure in-process scheduling (queue microtasks plus a couple of real
            // but tiny filesystem calls in `reserveOutput`), never the spawned child's own run
            // time. Once that spawn has happened, the wait is the bare `close` event with no
            // timeout of its own -- the child's real termination is the only thing that resolves
            // it, however long that takes under host CPU contention.
            const waitForChildClose = async (index: number): Promise<void> => {
                await vi.waitFor(() => expect(closeSignals.length).toBeGreaterThan(index));
                await closeSignals[index]!;
            };
            const fixture = makeModel({
                config: { thumbnail: root, thumbnailCmd: `%FFMPEG% ${script} %INPUT% %OUTPUT%` },
            });
            fixture.videoUtil.getFullFilePathFromId
                .mockResolvedValueOnce('slow-input.ts')
                .mockResolvedValueOnce('fast-input.ts')
                .mockResolvedValueOnce('failed-input.ts')
                .mockResolvedValueOnce('spawn-failure-input.ts')
                .mockResolvedValueOnce('slow-input.ts')
                .mockResolvedValueOnce('recovery-input.ts');

            fixture.model.add(901);
            fixture.model.add(902);
            await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce(), { timeout: REAL_CHILD_WAIT_MS });
            expect(fixture.thumbnailDB.insertOnce).not.toHaveBeenCalled();
            expect(fixture.thumbnailEvent.emitAdded).not.toHaveBeenCalled();
            expect(children[0]!.exitCode).toBeNull();
            expect(children).toHaveLength(1);
            expect(fixture.log.system.error).toHaveBeenCalledWith(stopFailure);

            children[0]!.kill('SIGTERM');
            await closeSignals[0]!;

            // 902's real spawn-run-cleanup chain is real child-process work (fork+exec of a fresh
            // Node process, script execution, exit, and reap), so its own duration must not share
            // a fixed wall-clock budget with anything else: `waitForChildClose(1)` waits for that
            // child's own real `close` event, not a wall clock. Only once that has actually
            // happened is the leftover in-process chain (`publishOutput`'s real-but-tiny fs calls,
            // then the mocked `insertOnce`) worth bounding with a short poll.
            await waitForChildClose(1);
            await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce());
            expect(fixture.thumbnailEvent.emitAdded).toHaveBeenCalledWith(902, 101);

            fixture.model.add(903);
            // `create thumbnail cmd error: 7` is logged synchronously inside the model's own
            // `close` handler for a nonzero exit code, so once this child's real `close` has fired
            // (waited for below, not on a wall clock) the log call has already happened -- no
            // polling needed for it.
            await waitForChildClose(2);
            expect(fixture.log.system.error).toHaveBeenCalledWith('create thumbnail cmd error: 7');
            expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce();

            spawnFailure = new Error('synthetic spawn failure');
            fixture.model.add(904);
            await vi.waitFor(() => expect(fixture.log.system.error).toHaveBeenCalledWith(spawnFailure));
            expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce();

            spawnFailure = null;
            fixture.model.add(905);
            fixture.model.add(906);
            await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2), { timeout: REAL_CHILD_WAIT_MS });
            expect(children).toHaveLength(4);
            expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledOnce();

            // The title's claim -- "releases the successor only after real child terminal
            // cleanup" -- is not pinned down by the `toHaveLength(4)` assertion
            // above alone, which is timing-dependent: it merely samples `children.length` at whatever
            // moment `vi.waitFor` happens to resolve, not at the instant children[3] (the live
            // child holding the lease) actually terminates. A source that released the successor
            // early (e.g. treating the deadline itself as terminal, instead of waiting for this
            // child's own `close`) would still normally pass that sample, because the successor's
            // real spawn-run-cleanup chain and the real `ProcessUtil.kill` grace period (see the
            // comment below on `await closeSignals[3]`) run concurrently and the sample can land
            // before either finishes.
            //
            // Binding the check to children[3]'s own `close` event instead makes it deterministic:
            // the listener below is attached here, well ahead of the grace period explained below,
            // so it cannot miss the event. If the successor (906) were released before children[3]
            // actually terminates, its own real spawn (via `useRealSpawn()`) would already have
            // pushed a 5th entry onto `children` and called `insertOnce` a second time by the time
            // this `close` fires, because a source doing that has no reason left to wait on this
            // child at all.
            let liveChildLeaseCloseSnapshot: { childCount: number; insertOnceCalls: number } | null = null;
            children[3]!.once('close', () => {
                liveChildLeaseCloseSnapshot = {
                    childCount: children.length,
                    insertOnceCalls: fixture.thumbnailDB.insertOnce.mock.calls.length,
                };
            });
            // `stop` being called only marks the moment `ProcessUtil.kill` was invoked for this
            // child, not the moment the live-child lease (children[3], the second `slow-input.ts`)
            // actually terminates: the real `ProcessUtil.kill` (unlike the mocked rejection used for
            // the first deadline above) schedules its SIGINT behind its own fixed internal grace-
            // period timer (`ProcessUtil.kill`'s `wait = 500` default in
            // `src/util/ProcessUtil.ts`), so this leg pays that grace period plus real signal
            // delivery before the successor (906) can even be spawned. `closeSignals[3]` waits on
            // that real event directly, with no timeout of its own, instead of folding this
            // load-sensitive wait inside a fixed budget shared with anything else.
            await closeSignals[3]!;
            // At the exact moment children[3] terminated for real, the successor must not have
            // been released yet: still 4 children spawned in total, and `insertOnce` still called
            // only for 902's earlier success.
            expect(liveChildLeaseCloseSnapshot).toEqual({ childCount: 4, insertOnceCalls: 1 });

            // The successor (906) is spawned only after this cleanup settles, and its own real
            // spawn-run-cleanup chain is exactly the kind of host-scheduling-dependent work that
            // must not share a fixed wall-clock budget with the grace period just paid above:
            // `waitForChildClose(4)` waits for 906's own real `close` event, not a wall clock. This
            // is the step that would time out under host CPU contention if it were folded inside
            // a single fixed `REAL_CHILD_WAIT_MS` budget together with that grace period
            // (`insertOnce` called once instead of twice at a 2s budget, while passing at ~895ms
            // on a quieter host).
            await waitForChildClose(4);
            await vi.waitFor(() => expect(fixture.thumbnailDB.insertOnce).toHaveBeenCalledTimes(2));
            expect(fixture.thumbnailEvent.emitAdded).toHaveBeenLastCalledWith(906, 101);
        } catch (err) {
            primaryError = err;
        }

        // Cleanup runs unconditionally, exactly as it did as a `finally` block, but its own
        // failures (e.g. `rm(root, ...)` rejecting with `ENOTEMPTY` when a temporary reservation
        // directory is still present) must not silently replace a genuine assertion failure from
        // the test body above -- a plain try/finally would let a throwing `finally` override
        // whatever the try block threw. The body's error is captured above and takes priority;
        // a cleanup failure is still surfaced, either on its own or combined with the body's error.
        let cleanupError: unknown;
        try {
            await Promise.all(
                children.map(async child => {
                    if (child.exitCode === null && child.signalCode === null) {
                        child.kill();
                        await once(child, 'close');
                    }
                    expect(child.exitCode === null && child.signalCode === null).toBe(false);
                    expect(child.listenerCount('close')).toBe(0);
                }),
            );
            restoreSpawn();
            ThumbnailManageModel.processTimeoutMs = originalTimeout;
            await rm(root, { force: true, recursive: true });
            await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
        } catch (err) {
            cleanupError = err;
        }

        if (primaryError !== undefined && cleanupError !== undefined) {
            throw new AggregateError(
                [primaryError, cleanupError],
                'test body failed and cleanup afterward also failed; see the aggregated errors for both',
            );
        }
        if (primaryError !== undefined) {
            throw primaryError;
        }
        if (cleanupError !== undefined) {
            throw cleanupError;
        }
    }, 30_000);
});
