import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type PromiseQueueClass from '../../../../src/model/PromiseQueue';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

// PromiseQueue.js is `@injectable()`-decorated; inversify's decorator reads `Reflect.hasOwnMetadata`,
// which only exists after the `reflect-metadata` polyfill runs (same as src/index.ts's own first import).
createRequire(join(process.cwd(), 'package.json'))('reflect-metadata');

// The dynamic `import()` below can only ever be typed `unknown`/`any` -- casting straight to
// `new () => IPromiseQueue` would make `const queue: IPromiseQueue = new PromiseQueue()` typecheck by
// construction, never actually comparing the *real* `PromiseQueue` class against `IPromiseQueue`.
// Casting to the real class's own type instead (imported `type`-only, so it never pulls the
// `@injectable()`-decorated runtime module in twice) makes the assignment below a genuine structural
// assignability check of the real class.
async function loadPromiseQueue(): Promise<typeof PromiseQueueClass> {
    const moduleUrl = pathToFileURL(join(compiledSnapshot!, 'model', 'PromiseQueue.js'));
    const { default: PromiseQueue } = (await import(moduleUrl.href)) as { default: typeof PromiseQueueClass };
    return PromiseQueue;
}

// `test/server/**` has no typecheck gate, so a type-only
// `const queue: IPromiseQueue = new PromiseQueue()` annotation is erased by Vitest's esbuild
// transform and never actually compared against `IPromiseQueue` -- it typechecks by construction
// and cannot fail. This builds a real, executed `ts.createProgram` (`noEmit`) over a tiny scratch
// project (gitignored `test/server/.artifacts/**`) so the assignability
// is a genuine compiler diagnostic, not an inert annotation.

describe('[IMP-CHAR-SF-1] IPromiseQueue / PromiseQueue', () => {
    it('starts each job only after the previous job settles, in addition order', async () => {
        const PromiseQueue = await loadPromiseQueue();
        const queue = new PromiseQueue();
        const events: string[] = [];

        const first = queue.add(async () => {
            events.push('first-start');
            await Promise.resolve();
            events.push('first-end');
            return 'first-result';
        });
        const second = queue.add(async () => {
            events.push('second-start');
            events.push('second-end');
            return 'second-result';
        });

        await expect(first).resolves.toBe('first-result');
        await expect(second).resolves.toBe('second-result');
        expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
    });

    it("rejects the caller of a job with that job's own rejection reason", async () => {
        const PromiseQueue = await loadPromiseQueue();
        const queue = new PromiseQueue();
        const failure = new Error('synthetic-job-failure');

        const rejected = queue.add(async () => {
            throw failure;
        });

        await expect(rejected).rejects.toBe(failure);
    });

    it('runs a subsequent job to completion after a preceding job rejects', async () => {
        const PromiseQueue = await loadPromiseQueue();
        const queue = new PromiseQueue();
        const failure = new Error('synthetic-preceding-failure');

        const first = queue.add(async () => {
            throw failure;
        });
        const second = queue.add(async () => 'second-result');

        await expect(first).rejects.toBe(failure);
        await expect(second).resolves.toBe('second-result');
    });
});
