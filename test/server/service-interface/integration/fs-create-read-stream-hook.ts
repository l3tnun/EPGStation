/**
 * Registers a Node loader-hook replacement for the compiled `api.js`'s `import * as fs from 'fs'`, so
 * a per-test `createReadStream` implementation can be observed for requests served by the real,
 * running `origin`/`raceOrigin` HTTP servers in `service-interface.integration.test.ts`.
 *
 * Why `vi.spyOn`/`vi.doMock` cannot reach this call (verified, not assumed): `src/model/service/
 * api.ts` does `import * as fs from 'fs'`. A namespace import of a Node builtin resolves through the
 * builtin's ESM facade, which snapshots the module's named exports the first time anything imports it
 * as ESM. Patching `require('node:fs').createReadStream` afterwards (what `vi.spyOn(require('node:fs'),
 * 'createReadStream')` does) mutates the *CommonJS* exports object, not the already-snapshotted ESM
 * binding `api.js` closed over, so the spy is invisible to it. Minimal repro that confirmed this
 * (outside this repo, plain Node ESM, no vitest): a module doing `import * as fs from 'fs'; export
 * const call = () => fs.createReadStream(...)` keeps returning a real `ReadStream` after
 * `require('node:fs').createReadStream = patched` runs post-import, but returns the patched value when
 * the same reassignment runs *before* the importing module is first loaded.
 *
 * Separately, `api.js` itself is not loaded by this test file's own `import`/`require` graph at all:
 * `express-openapi` loads it via its own directory scan (`ServiceServer#initOpenApi`, `paths:
 * ServiceServer.API_DIR`) using whatever module resolution the installed `express-openapi` version
 * uses internally (a `require()`, possibly Node's `require(esm)`), which vitest's own import/require
 * rewriting never sees (that rewriting only covers call sites vite-node itself transforms, i.e. this
 * test file's own static imports and its own `require()`/`import()` calls -- not arbitrary resolution
 * performed deep inside a third-party dependency at runtime).
 *
 * A Node loader hook registered with `module.registerHooks()` sits below all of that: every module
 * resolution in this process -- including a plain `require()` made by a third-party dependency, and
 * `require(esm)` -- passes through it. This reuses the shared hook module the harness already spawns
 * child processes with (`test/server/harness/child-module-overrides.mjs`; left untouched, other tests
 * depend on it) but calls its `registerOverrides` *in this same process* instead, scoped via
 * `parentURL` to just the compiled `api.js` module so no other module's `fs`/`node:fs` import is
 * affected.
 *
 * Registration must happen before `api.js` is loaded anywhere in this process: Node resolves and
 * caches a module's own imports the first time that module is evaluated, so a hook registered after
 * that point is too late for the binding `api.js` already closed over. `api.js` loads lazily (only
 * once `ServiceServer#initOpenApi` actually runs, inside `startListenerFixture`, itself called from a
 * `beforeAll`/test body) -- but to stay unconditionally ahead of that, this module is imported as the
 * very first import of `service-interface.integration.test.ts`. ES module evaluation runs each static
 * import's module graph to completion, in source order, before executing anything else in that file,
 * so this registration always completes before any later import in that file (including
 * `../fixtures/listener-matrix`, which is what actually starts a server) and before any of that file's
 * own top-level or test code runs.
 *
 * The replacement module re-exports the real `fs` for everything else (`api.js` also calls
 * `fs.statSync`) and only redirects `createReadStream` to
 * `globalThis.__epgstationTestFs?.createReadStream`, falling back to the real implementation when a
 * test has not set an override. That keeps the hook a no-op by default: tests opt in per-case via
 * `setTestCreateReadStream`, and `resetTestCreateReadStream` (wired into this file's shared
 * `afterEach`) restores the default so later tests are unaffected.
 */
import { pathToFileURL } from 'node:url';

import { registerOverrides } from '../../harness/child-module-overrides.mjs';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('Server test runner did not provide its compiled snapshot');
}

declare global {
    var __epgstationTestFs: { createReadStream: typeof import('node:fs').createReadStream } | undefined;
}

const apiModuleUrl = pathToFileURL(`${compiledSnapshot}/model/service/api.js`).href;

const fsShimSource = [
    "import * as realFs from 'node:fs';",
    'const delegate = (...args) => (globalThis.__epgstationTestFs?.createReadStream ?? realFs.createReadStream)(...args);',
    "export * from 'node:fs';",
    'export const createReadStream = delegate;',
    'export default { ...realFs, createReadStream: delegate };',
].join('\n');

registerOverrides([
    { parentURL: apiModuleUrl, specifier: 'fs', source: fsShimSource },
    { parentURL: apiModuleUrl, specifier: 'node:fs', source: fsShimSource },
]);

/** Points `api.js`'s `fs.createReadStream` at `impl` until `resetTestCreateReadStream` is called. */
export const setTestCreateReadStream = (impl: typeof import('node:fs').createReadStream): void => {
    globalThis.__epgstationTestFs = { createReadStream: impl };
};

/** Restores `api.js`'s `fs.createReadStream` to the real implementation. */
export const resetTestCreateReadStream = (): void => {
    globalThis.__epgstationTestFs = undefined;
};
