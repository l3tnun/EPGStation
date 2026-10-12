/**
 * Registers a Node loader-hook replacement for the compiled `EPGUpdateExecutorManageModel.js`'s
 * `import * as child_process from 'child_process'`, so `program-guide-boundaries.integration.test.ts`
 * can observe and control `spawn` calls made by a real `new EPGUpdateExecutorManageModel(...)`
 * instance.
 *
 * Why `vi.spyOn(require('node:child_process'), 'spawn')` cannot reach this call (verified, not
 * assumed): `src/model/epgUpdater/EPGUpdateExecutorManageModel.ts` does
 * `import * as child_process from 'child_process'`. A namespace import of a Node builtin resolves
 * through the builtin's ESM facade, which snapshots the module's named exports the first time
 * anything imports it as ESM. Patching `require('node:child_process').spawn = patched` afterwards
 * mutates the *CommonJS* exports object, not the already-snapshotted ESM binding
 * `EPGUpdateExecutorManageModel.js` closed over, so the patch is invisible to it -- observed here as
 * `spawn` never being called (`expected "spawn" to be called once, but got 0 times`), same failure
 * mode documented in `../configuration/fs-override-hook.ts` for `fs`.
 *
 * A Node loader hook registered with `module.registerHooks()` sits below all of that: every module
 * resolution in this process passes through it. This reuses the shared hook module the harness
 * already spawns child processes with (`test/server/harness/child-module-overrides.mjs`; left
 * untouched, other tests depend on it) but calls its `registerOverrides` *in this same process*
 * instead, scoped via `parentURL` to just the compiled `EPGUpdateExecutorManageModel.js` module so
 * no other module's `child_process`/`node:child_process` import is affected.
 *
 * Registration must happen before `EPGUpdateExecutorManageModel.js` is loaded anywhere in this
 * process: Node resolves and caches a module's own imports the first time that module is evaluated,
 * so a hook registered after that point is too late for the binding
 * `EPGUpdateExecutorManageModel.js` already closed over. This module is imported as the very first
 * import of `program-guide-boundaries.integration.test.ts`, and ES module evaluation runs each
 * static import's module graph to completion, in source order, before executing anything else in
 * that file -- so this registration always completes before the later
 * `require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js'))` call.
 *
 * The replacement module re-exports the real `child_process` for everything else and only redirects
 * `spawn` to `globalThis.__epgstationEPGUpdateExecutorChildProcess`, falling back to the real
 * implementation when a test has not set an override. `childProcessOverrides` is the exact object
 * `globalThis.__epgstationEPGUpdateExecutorChildProcess` points at, so a test can mutate its
 * properties directly and the shim observes the change immediately (no re-registration needed per
 * test).
 */
import { pathToFileURL } from 'node:url';

import { registerOverrides } from '../harness/child-module-overrides.mjs';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('Server test runner did not provide its compiled snapshot');
}

interface ChildProcessOverrides {
    spawn?: (...args: unknown[]) => unknown;
}

declare global {
    var __epgstationEPGUpdateExecutorChildProcess: ChildProcessOverrides | undefined;
}

/** Mutate this object's properties from a test to control what `EPGUpdateExecutorManageModel` observes. */
export const childProcessOverrides: ChildProcessOverrides = {};
globalThis.__epgstationEPGUpdateExecutorChildProcess = childProcessOverrides;

/** Clears every override so `EPGUpdateExecutorManageModel` falls back to the real `child_process` implementation. */
export const resetChildProcessOverrides = (): void => {
    delete childProcessOverrides.spawn;
};

const managerModuleUrl = pathToFileURL(
    `${compiledSnapshot}/model/epgUpdater/EPGUpdateExecutorManageModel.js`,
).href;

const childProcessShimSource = [
    "import * as realChildProcess from 'node:child_process';",
    'const overrides = () => globalThis.__epgstationEPGUpdateExecutorChildProcess;',
    "export * from 'node:child_process';",
    'export const spawn = (...args) => (overrides()?.spawn ?? realChildProcess.spawn)(...args);',
    'export default { ...realChildProcess, spawn };',
].join('\n');

registerOverrides([
    { parentURL: managerModuleUrl, specifier: 'child_process', source: childProcessShimSource },
    { parentURL: managerModuleUrl, specifier: 'node:child_process', source: childProcessShimSource },
]);
