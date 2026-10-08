import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDependencies, ProcessExit } from './_harness';

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const originalArgv = process.argv;
const originalExit = process.exit;

afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    vi.doUnmock(join(snapshot, 'model', 'ModelContainer.js'));
    vi.doUnmock(join(snapshot, 'model', 'ModelContainerSetter.js'));
    vi.restoreAllMocks();
});

/**
 * Imports the compiled tool as the process entry script (argv[1] is the tool's own file), so its
 * end-of-file direct-start guard instantiates and runs it. The tool is started with no arguments, so the
 * constructor's argument check ends the run before any container dependency is read.
 */
const startAsEntryScript = async (filename: 'DBTools.js' | 'V1MigrationTool.js') => {
    const toolPath = join(snapshot, filename);
    const harness = makeDependencies();
    vi.doMock(join(snapshot, 'model', 'ModelContainer.js'), () => ({ __esModule: true, default: harness.container }));
    vi.doMock(join(snapshot, 'model', 'ModelContainerSetter.js'), () => ({ set: vi.fn() }));
    process.argv = ['node', toolPath];
    process.exit = ((code?: number) => {
        throw new ProcessExit(code ?? 0);
    }) as never;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.resetModules();
    await expect(import(pathToFileURL(toolPath).href)).rejects.toMatchObject({ code: 1 });
    return { consoleError, harness };
};

describe('management tool direct start', () => {
    it('[IMP-CHAR-MT-7.2] starts the database backup tool when it is the entry script and stops on missing arguments', async () => {
        const { consoleError, harness } = await startAsEntryScript('DBTools.js');

        expect(consoleError).toHaveBeenCalledExactlyOnceWith('引数が足りません');
        expect(harness.container.get).not.toHaveBeenCalled();
    });

    it('[IMP-CHAR-MT-7.2] starts the v1 migration tool when it is the entry script and stops without an input file', async () => {
        const { consoleError, harness } = await startAsEntryScript('V1MigrationTool.js');

        expect(consoleError).toHaveBeenCalledExactlyOnceWith('v1のバックアップファイルを指定してください');
        expect(harness.container.get).not.toHaveBeenCalled();
    });
});
