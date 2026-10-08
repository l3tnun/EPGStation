/**
 * Registers a Node loader-hook replacement for the compiled `ConfigurationFileAccess.js`'s
 * `import * as fs from 'fs'`, so `implementation.test.ts` can observe and control `readFileSync`,
 * `promises.readFile`, and `watchFile` calls made by a real `new Configuration(...)` instance.
 *
 * Why `vi.spyOn`/mutating `require('node:fs')` cannot reach this call (verified, not assumed):
 * `src/model/ConfigurationFileAccess.ts` does `import * as fs from 'fs'`. A namespace import of a
 * Node builtin resolves through the builtin's ESM facade, which snapshots the module's named exports
 * the first time anything imports it as ESM. Patching `require('node:fs').readFileSync = patched`
 * afterwards mutates the *CommonJS* exports object, not the already-snapshotted ESM binding
 * `ConfigurationFileAccess.js` closed over, so the patch is invisible to it -- this is exactly the
 * failure a test hits without this hook (`process.exit unexpectedly called with "1"`,
 * because the real `fs.readFileSync` ran against the real, absent `config/config.yml` instead of the
 * test double).
 *
 * A Node loader hook registered with `module.registerHooks()` sits below all of that: every module
 * resolution in this process passes through it. This reuses the shared hook module the harness
 * already spawns child processes with (`test/server/harness/child-module-overrides.mjs`; left
 * untouched, other tests depend on it) but calls its `registerOverrides` *in this same process*
 * instead, scoped via `parentURL` to just the compiled `ConfigurationFileAccess.js` module so no
 * other module's `fs`/`node:fs` import is affected.
 *
 * Registration must happen before `ConfigurationFileAccess.js` is loaded anywhere in this process:
 * Node resolves and caches a module's own imports the first time that module is evaluated, so a hook
 * registered after that point is too late for the binding `ConfigurationFileAccess.js` already closed
 * over. This module is imported as the very first import of `implementation.test.ts`, and ES module
 * evaluation runs each static import's module graph to completion, in source order, before executing
 * anything else in that file -- so this registration always completes before the later
 * `require(join(compiledSnapshot, 'model', 'Configuration.js'))` call that transitively loads
 * `ConfigurationFileAccess.js`.
 *
 * The replacement module re-exports the real `fs` for everything else and only redirects
 * `readFileSync`, `watchFile`, and `promises.readFile` to `globalThis.__epgstationConfigFs`, falling
 * back to the real implementation when a test has not set an override. `configFsOverrides` is the
 * exact object `globalThis.__epgstationConfigFs` points at, so a test can mutate its properties
 * directly and the shim observes the change immediately (no re-registration needed per test).
 */
import { pathToFileURL } from 'node:url';

import { registerOverrides } from '../harness/child-module-overrides.mjs';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('Server test runner did not provide its compiled snapshot');
}

interface ConfigFsOverrides {
    readFileSync?: (...args: unknown[]) => unknown;
    readFile?: (...args: unknown[]) => Promise<unknown>;
    watchFile?: (...args: unknown[]) => unknown;
    unwatchFile?: (...args: unknown[]) => unknown;
}

declare global {
    var __epgstationConfigFs: ConfigFsOverrides | undefined;
}

/** Mutate this object's properties from a test to control what `ConfigurationFileAccess` observes. */
export const configFsOverrides: ConfigFsOverrides = {};
globalThis.__epgstationConfigFs = configFsOverrides;

/** Clears every override so `ConfigurationFileAccess` falls back to the real `fs` implementation. */
export const resetConfigFsOverrides = (): void => {
    delete configFsOverrides.readFileSync;
    delete configFsOverrides.readFile;
    delete configFsOverrides.watchFile;
    delete configFsOverrides.unwatchFile;
};

const configurationFileAccessUrl = pathToFileURL(`${compiledSnapshot}/model/ConfigurationFileAccess.js`).href;

const fsShimSource = [
    "import * as realFs from 'node:fs';",
    'const overrides = () => globalThis.__epgstationConfigFs;',
    "export * from 'node:fs';",
    'export const readFileSync = (...args) => (overrides()?.readFileSync ?? realFs.readFileSync)(...args);',
    'export const watchFile = (...args) => (overrides()?.watchFile ?? realFs.watchFile)(...args);',
    'export const unwatchFile = (...args) => (overrides()?.unwatchFile ?? realFs.unwatchFile)(...args);',
    'export const promises = { ...realFs.promises, readFile: (...args) => (overrides()?.readFile ?? realFs.promises.readFile)(...args) };',
    'export default { ...realFs, readFileSync, watchFile, unwatchFile, promises };',
].join('\n');

registerOverrides([
    { parentURL: configurationFileAccessUrl, specifier: 'fs', source: fsShimSource },
    { parentURL: configurationFileAccessUrl, specifier: 'node:fs', source: fsShimSource },
]);
