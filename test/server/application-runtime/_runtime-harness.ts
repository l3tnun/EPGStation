import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { Container } from 'inversify';
import { vi } from 'vitest';

/**
 * Shared, compiled-dist-backed harness for `application-runtime` integration tests. Extracted because
 * `evaluateCompiledRuntime`, `captureRuntimeListeners`, and `removeListenersAddedSince` were byte-identical between
 * `integration/runtime-boundaries.integration.test.ts` and `encode-completion-binding.integration.test.ts`, and
 * `buildRuntimeContainer`/`createSyntheticChild` were duplicated between the two Runtime cross-spec deletion
 * binding tests. Each caller still owns its own fixture container shape and assertions.
 */

export type RuntimeGlobalEvent = 'uncaughtException' | 'unhandledRejection';
export type RuntimeListenerFunction = (...arguments_: unknown[]) => void;

const runtimeGlobalEvents: readonly RuntimeGlobalEvent[] = ['uncaughtException', 'unhandledRejection'];
const compiledModuleRequire = createRequire(join(process.cwd(), 'package.json'));

export const compiledSnapshotRoot = (): string => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
        throw new Error('Server test runner did not provide an absolute compiled snapshot');
    }
    return compiledSnapshot;
};

/** Loads the compiled dist's default export at `relativePath` (e.g. `model/ipc/IPCServer.js`). */
export const loadDefault = <T>(relativePath: string): T =>
    (compiledModuleRequire(join(compiledSnapshotRoot(), relativePath)) as { default: T }).default;

export const captureRuntimeListeners = (): ReadonlyMap<RuntimeGlobalEvent, readonly RuntimeListenerFunction[]> =>
    new Map(runtimeGlobalEvents.map(event => [event, process.listeners(event) as RuntimeListenerFunction[]]));

export const removeListenersAddedSince = (
    before: ReadonlyMap<RuntimeGlobalEvent, readonly RuntimeListenerFunction[]>,
): void => {
    for (const event of runtimeGlobalEvents) {
        const existing = before.get(event) ?? [];
        for (const listener of process.listeners(event)) {
            if (!existing.includes(listener as RuntimeListenerFunction)) {
                process.removeListener(event, listener as RuntimeListenerFunction);
            }
        }
    }
};

/**
 * Loads the compiled `index.js` entrypoint in-process (no OS child spawn) against a caller-supplied
 * `container` / `spawnServiceChild`, so fake timers and synchronous ledger observation stay usable and
 * V8 attributes coverage to the real on-disk script. Runs the entrypoint's own top-level work without
 * awaiting it; callers advance fake timers / `vi.waitFor` afterward.
 *
 * The stubs are installed through the test runner's own module registry rather than by patching Node's
 * CommonJS loader. The compiled output is ES modules, whose imports the CommonJS loader never sees, so
 * a `Module._load` patch would leave the entrypoint importing the real container and the real
 * `child_process`. `vi.doMock` names the exact files the entrypoint imports, and the registry is reset
 * afterwards so the stubs do not reach any other test.
 *
 * The entrypoint's module cache entry is dropped before each call so repeated invocations across tests
 * each re-run its top-level side effects fresh.
 */
export const evaluateCompiledRuntime = async (
    container: { get(identifier: string): unknown },
    spawnServiceChild: () => unknown,
    onModelContainerSet?: () => void,
): Promise<void> => {
    const compiledSnapshot = compiledSnapshotRoot();
    const entrypoint = join(compiledSnapshot, 'index.js');

    vi.doMock('node:child_process', () => ({ spawn: spawnServiceChild }));
    vi.doMock('child_process', () => ({ spawn: spawnServiceChild }));
    vi.doMock('reflect-metadata', () => ({}));
    vi.doMock('source-map-support', () => ({ default: { install: () => undefined }, install: () => undefined }));
    vi.doMock(join(compiledSnapshot, 'model', 'ModelContainer.js'), () => ({
        __esModule: true,
        default: container,
    }));
    vi.doMock(join(compiledSnapshot, 'model', 'ModelContainerSetter.js'), () => ({
        set: () => onModelContainerSet?.(),
    }));

    try {
        vi.resetModules();
        await import(entrypoint);
    } finally {
        vi.doUnmock('node:child_process');
        vi.doUnmock('child_process');
        vi.doUnmock('reflect-metadata');
        vi.doUnmock('source-map-support');
        vi.doUnmock(join(compiledSnapshot, 'model', 'ModelContainer.js'));
        vi.doUnmock(join(compiledSnapshot, 'model', 'ModelContainerSetter.js'));
    }
};

export type SyntheticChild = EventEmitter & {
    readonly pid: number;
    readonly send: ReturnType<typeof vi.fn>;
    readonly stderr: null;
    readonly stdout: null;
};

/** A minimal ChildProcess-shaped EventEmitter standing in for the real IPC transport (`message`/`send`). */
export const createSyntheticChild = (pid: number): SyntheticChild =>
    Object.assign(new EventEmitter(), {
        pid,
        send: vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
            callback?.(null);
            return true;
        }),
        stderr: null,
        stdout: null,
    }) as SyntheticChild;

/**
 * Wires the real, compiled `ModelContainerSetter` so `IIPCServer` resolves to the actual production `IPCServer`
 * class (the parent handler adapter), then rebinds only the tokens the Runtime cross-spec deletion binding tests
 * do not exercise to inert fixtures. `IRecordedManageModel` and `IRecordingManageModel` are left to the caller so
 * each test can observe the exact provider-port identity the parent coordinator reaches.
 */
export const buildRuntimeContainer = (): Container => {
    const { set } = compiledModuleRequire(join(compiledSnapshotRoot(), 'model', 'ModelContainerSetter.js')) as {
        set(container: Container): void;
    };
    const container = new Container();
    set(container);
    container.rebind('ILoggerModel').toConstantValue({
        getLogger: () => ({ system: { error: () => undefined, fatal: () => undefined, info: () => undefined } }),
    });
    // RecordedUploadAdoptionModel is constructed eagerly as part of the real IPCServer's DI graph; its own
    // `.initialize()` (filesystem side effects) is never invoked by these tests, so a synthetic path is safe here.
    container.rebind('IConfiguration').toConstantValue({
        getConfig: () => ({ uploadTempDir: 'synthetic-runtime-upload-fixture' }),
    });
    for (const token of [
        'IReservationManageModel',
        'IRecordedTagManadeModel',
        'IRuleManageModel',
        'IThumbnailManageModel',
    ]) {
        container.rebind(token).toConstantValue({});
    }
    return container;
};
