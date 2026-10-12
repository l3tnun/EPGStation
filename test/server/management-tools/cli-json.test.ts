import { describe, expect, it, vi } from 'vitest';
import { loadTool, makeDependencies, versionlessBackup, withProcess } from './_harness';

describe('management parser and JSON characterization', () => {
    it('[MT-1.4] treats an empty v1 input as a single failed read before DB use', async () => {
        const harness = makeDependencies();
        const readFileSync = vi.fn(() => {
            throw Object.assign(new Error('empty path'), { code: 'ENOENT' });
        });
        const Tool = await loadTool('V1MigrationTool.js', harness.container, { readFileSync, writeFileSync: vi.fn() });
        const tool = await withProcess(['--input', ''], () => new Tool());
        await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 1 }));
        expect(readFileSync).toHaveBeenCalledOnce();
        expect(harness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
    });

    it('[MT-3.1] sends parsed null through the production restore path and fails before a repository call', async () => {
        const harness = makeDependencies();
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync: vi.fn(() => 'null'),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        await expect(tool.restore()).rejects.toBeInstanceOf(TypeError);
        expect(harness.dependencies.IRuleDB.restore).not.toHaveBeenCalled();
    });

    it.each([
        ['zero', '0'],
        ['one', '1'],
    ])(
        '[MT-3.1] sends parsed %s through reached production stages without global shape validation',
        async (_name, source) => {
            const harness = makeDependencies();
            const Tool = await loadTool('DBTools.js', harness.container, {
                readFileSync: vi.fn(() => source),
                writeFileSync: vi.fn(),
            });
            const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
            await tool.restore();
            expect(harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith(undefined);
            expect(harness.dependencies.IRecordedTagDB.restore).toHaveBeenCalledWith(undefined);
        },
    );

    it('[MT-3.1] gives the production restore path the last duplicate root collection', async () => {
        const harness = makeDependencies();
        const { ruleItems: _discarded, ...remaining } = versionlessBackup();
        const document = `{"ruleItems":[{"id":1}],"ruleItems":[{"id":2}],${JSON.stringify(remaining).slice(1)}`;
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync: vi.fn(() => document),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        await tool.restore();
        expect(harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith([{ id: 2 }]);
    });

    it('[IMP-CHAR-MT-7.2:dbtools-missing-empty-before-file-and-db] rejects DBTools missing/empty values before file and DB use', async () => {
        for (const argv of [
            ['--output', 'synthetic-output'],
            ['--mode', '', '--output', 'synthetic-output'],
            ['--mode', 'backup'],
            ['--mode', 'backup', '--output', ''],
        ]) {
            const harness = makeDependencies();
            const filesystem = { readFileSync: vi.fn(), writeFileSync: vi.fn() };
            const Tool = await loadTool('DBTools.js', harness.container, filesystem);
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                await expect(withProcess(argv, () => new Tool())).rejects.toEqual(expect.objectContaining({ code: 1 }));
                expect(harness.container.get).not.toHaveBeenCalled();
                expect(harness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
                expect(filesystem.readFileSync).not.toHaveBeenCalled();
                expect(filesystem.writeFileSync).not.toHaveBeenCalled();
            } finally {
                error.mockRestore();
            }
        }

        for (const output of ['0', '1']) {
            const harness = makeDependencies();
            const writeFileSync = vi.fn();
            const Tool = await loadTool('DBTools.js', harness.container, { readFileSync: vi.fn(), writeFileSync });
            const tool = await withProcess(['--mode', 'backup', '--output', output], () => new Tool());
            await tool.backup();
            expect(writeFileSync).toHaveBeenCalledOnce();
            expect(writeFileSync).toHaveBeenCalledWith(output, expect.any(String), { encoding: 'utf-8' });
        }

        const invalidModeHarness = makeDependencies();
        const invalidModeFilesystem = {
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
        };
        const InvalidModeTool = await loadTool('DBTools.js', invalidModeHarness.container, invalidModeFilesystem);
        const invalidModeError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(
                withProcess(['--mode', '0', '--output', 'synthetic-output'], () => new InvalidModeTool()),
            ).rejects.toEqual(expect.objectContaining({ code: 1 }));
            await expect(
                withProcess(
                    ['--mode', 'backup', '--mode', 'restore', '--output', 'synthetic-output'],
                    () => new InvalidModeTool(),
                ),
            ).rejects.toEqual(expect.objectContaining({ code: 1 }));
            expect(invalidModeHarness.container.get).not.toHaveBeenCalled();
            expect(invalidModeFilesystem.readFileSync).not.toHaveBeenCalled();
            expect(invalidModeFilesystem.writeFileSync).not.toHaveBeenCalled();
        } finally {
            invalidModeError.mockRestore();
        }

        const duplicateOutputHarness = makeDependencies();
        const writeFileSync = vi.fn((path: unknown) => {
            if (Array.isArray(path)) throw new TypeError('synthetic duplicate output path');
        });
        const DuplicateOutputTool = await loadTool('DBTools.js', duplicateOutputHarness.container, {
            readFileSync: vi.fn(),
            writeFileSync,
        });
        const duplicateOutputTool = await withProcess(
            ['--mode', 'backup', '--output', 'first', '--output', 'second'],
            () => new DuplicateOutputTool(),
        );
        await expect(duplicateOutputTool.backup()).rejects.toThrow('synthetic duplicate output path');
        expect(writeFileSync).toHaveBeenCalledWith(['first', 'second'], expect.any(String), { encoding: 'utf-8' });

        const lifecycleHarness = makeDependencies();
        const lifecycleWrite = vi.fn();
        const LifecycleTool = await loadTool('DBTools.js', lifecycleHarness.container, {
            readFileSync: vi.fn(),
            writeFileSync: lifecycleWrite,
        });
        const lifecycleTool = await withProcess(
            ['--mode', 'backup', '--output', 'synthetic-output'],
            () => new LifecycleTool(),
        );
        await expect(withProcess([], () => lifecycleTool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
        expect(lifecycleHarness.dependencies.IRecordedDB.findAll).toHaveBeenCalledWith(
            { isHalfWidth: false },
            {
                isNeedVideoFiles: false,
                isNeedThumbnails: false,
                isNeedsDropLog: false,
                isNeedTags: false,
            },
        );
        expect(lifecycleWrite).toHaveBeenCalledOnce();
        expect(lifecycleWrite).toHaveBeenCalledWith('synthetic-output', JSON.stringify(versionlessBackup()), {
            encoding: 'utf-8',
        });
        expect(Object.keys(JSON.parse(lifecycleWrite.mock.calls[0][1] as string))).toEqual([
            'ruleItems',
            'reserveItems',
            'recordedItems',
            'thumbnailItems',
            'videoFileItems',
            'dropLogFileItems',
            'recordedHistoryItems',
            'recordedTagItems',
        ]);
        expect(lifecycleHarness.ledger.indexOf('close-db')).toBeLessThan(
            lifecycleHarness.ledger.indexOf('log:--- finish ---'),
        );

        const writeFailureHarness = makeDependencies();
        const writeFailure = new Error('synthetic direct write failure');
        const writeFailureSync = vi.fn(() => {
            throw writeFailure;
        });
        const WriteFailureTool = await loadTool('DBTools.js', writeFailureHarness.container, {
            readFileSync: vi.fn(),
            writeFileSync: writeFailureSync,
        });
        const writeFailureTool = await withProcess(
            ['--mode', 'backup', '--output', 'synthetic-output'],
            () => new WriteFailureTool(),
        );
        await expect(writeFailureTool.backup()).rejects.toBe(writeFailure);
        expect(writeFailureSync).toHaveBeenCalledOnce();
        expect(writeFailureHarness.dependencies.IRuleDB.findAll).toHaveBeenCalledOnce();
        expect(writeFailureHarness.dependencies.IRecordedTagDB.findAll).toHaveBeenCalledOnce();
    });

    it('[IMP-CHAR-MT-7.2:v1-missing-before-read-and-db] rejects missing v1 input before read/DB and characterizes nonempty/duplicate paths', async () => {
        const missingHarness = makeDependencies();
        const filesystem = { readFileSync: vi.fn(), writeFileSync: vi.fn() };
        const MissingTool = await loadTool('V1MigrationTool.js', missingHarness.container, filesystem);
        const missingError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(withProcess([], () => new MissingTool())).rejects.toEqual(
                expect.objectContaining({ code: 1 }),
            );
            expect(missingHarness.container.get).not.toHaveBeenCalled();
            expect(filesystem.readFileSync).not.toHaveBeenCalled();
            expect(filesystem.writeFileSync).not.toHaveBeenCalled();
        } finally {
            missingError.mockRestore();
        }

        for (const input of ['0', '1']) {
            const harness = makeDependencies();
            const readFileSync = vi.fn(() => {
                throw new Error(`synthetic ${input} v1 input`);
            });
            const Tool = await loadTool('V1MigrationTool.js', harness.container, {
                readFileSync,
                writeFileSync: vi.fn(),
            });
            const tool = await withProcess(['--input', input], () => new Tool());
            await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 1 }));
            expect(readFileSync).toHaveBeenCalledOnce();
            expect(readFileSync).toHaveBeenCalledWith(input, 'utf-8');
            expect(harness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
        }

        const unreadableHarness = makeDependencies();
        const unreadableRead = vi.fn(() => {
            throw new Error('synthetic unreadable v1 input');
        });
        const UnreadableTool = await loadTool('V1MigrationTool.js', unreadableHarness.container, {
            readFileSync: unreadableRead,
            writeFileSync: vi.fn(),
        });
        const unreadableTool = await withProcess(['--input', 'synthetic-unreadable'], () => new UnreadableTool());
        await expect(withProcess([], () => unreadableTool.run())).rejects.toEqual(expect.objectContaining({ code: 1 }));
        expect(unreadableRead).toHaveBeenCalledOnce();
        expect(unreadableHarness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();

        const duplicateInputHarness = makeDependencies();
        const duplicateRead = vi.fn(() => {
            throw new Error('synthetic duplicate v1 input path');
        });
        const DuplicateInputTool = await loadTool('V1MigrationTool.js', duplicateInputHarness.container, {
            readFileSync: duplicateRead,
            writeFileSync: vi.fn(),
        });
        const duplicateInputTool = await withProcess(
            ['--input', 'first', '--input', 'second'],
            () => new DuplicateInputTool(),
        );
        await expect(withProcess([], () => duplicateInputTool.run())).rejects.toEqual(
            expect.objectContaining({ code: 1 }),
        );
        expect(duplicateRead).toHaveBeenCalledOnce();
        expect(duplicateRead).toHaveBeenCalledWith(['first', 'second'], 'utf-8');
        expect(duplicateInputHarness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
    });

    it('[IMP-CHAR-MT-7.2:v1-empty-read-once-before-db] passes empty v1 input to exactly one failed read before DB use', async () => {
        const emptyHarness = makeDependencies();
        const emptyRead = vi.fn(() => {
            throw Object.assign(new Error('synthetic empty v1 input'), { code: 'ENOENT' });
        });
        const emptyWrite = vi.fn();
        const EmptyTool = await loadTool('V1MigrationTool.js', emptyHarness.container, {
            readFileSync: emptyRead,
            writeFileSync: emptyWrite,
        });
        const emptyTool = await withProcess(['--input', ''], () => new EmptyTool());
        await expect(withProcess([], () => emptyTool.run())).rejects.toEqual(expect.objectContaining({ code: 1 }));
        expect(emptyRead).toHaveBeenCalledOnce();
        expect(emptyWrite).not.toHaveBeenCalled();
        expect(emptyHarness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
    });

    it('[IMP-CHAR-MT-7.2:json-null-empty-zero-one-invalid-duplicate] characterizes JSON root and collection values', async () => {
        const readRestore = async (source: string, overrides: Record<string, unknown> = {}) => {
            const harness = makeDependencies(overrides);
            const Tool = await loadTool('DBTools.js', harness.container, {
                readFileSync: vi.fn(() => source),
                writeFileSync: vi.fn(),
            });
            const tool = await withProcess(['--mode', 'restore', '--output', 'synthetic-input'], () => new Tool());
            return { harness, tool };
        };

        const empty = await readRestore('');
        const emptyError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(withProcess([], () => empty.tool.restore())).rejects.toEqual(
                expect.objectContaining({ code: 1 }),
            );
            expect(empty.harness.dependencies.IRuleDB.restore).not.toHaveBeenCalled();
        } finally {
            emptyError.mockRestore();
        }

        const invalidJson = await readRestore('{invalid');
        const invalidJsonError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(withProcess([], () => invalidJson.tool.restore())).rejects.toEqual(
                expect.objectContaining({ code: 1 }),
            );
            expect(invalidJson.harness.dependencies.IRuleDB.restore).not.toHaveBeenCalled();
        } finally {
            invalidJsonError.mockRestore();
        }

        const nullRoot = await readRestore('null');
        await expect(nullRoot.tool.restore()).rejects.toBeInstanceOf(TypeError);
        expect(nullRoot.harness.dependencies.IRuleDB.restore).not.toHaveBeenCalled();

        for (const root of ['0', '1']) {
            const primitive = await readRestore(root);
            await primitive.tool.restore();
            expect(primitive.harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith(undefined);
        }

        const emptyCollections = Object.fromEntries(Object.keys(versionlessBackup()).map(key => [key, []]));
        const emptyDocument = await readRestore(JSON.stringify(emptyCollections));
        await emptyDocument.tool.restore();
        expect(emptyDocument.harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith([]);

        const oneDocument = await readRestore(JSON.stringify(versionlessBackup()));
        await oneDocument.tool.restore();
        expect(oneDocument.harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith(versionlessBackup().ruleItems);
        expect(oneDocument.harness.ledger.filter(value => value.startsWith('restore:'))).toEqual([
            'restore:rule',
            'restore:reserve',
            'restore:drop-log',
            'restore:recorded',
            'restore:thumbnail',
            'restore:video-file',
            'restore:recorded-history',
            'restore:recorded-tag',
        ]);

        const invalidCollection = await readRestore(JSON.stringify({ ...versionlessBackup(), ruleItems: null }), {
            IRuleDB: {
                restore: vi.fn(async () => {
                    throw new TypeError('synthetic rule collection');
                }),
            },
        });
        await expect(invalidCollection.tool.restore()).rejects.toThrow('synthetic rule collection');
        expect(invalidCollection.harness.dependencies.IReserveDB.restore).not.toHaveBeenCalled();

        const duplicateRows = [{ id: 11 }, { id: 11 }];
        const constraintFailure = await readRestore(
            JSON.stringify({ ...versionlessBackup(), ruleItems: duplicateRows }),
            {
                IRuleDB: {
                    restore: vi.fn(async () => {
                        throw new Error('synthetic duplicate rule constraint');
                    }),
                },
            },
        );
        await expect(constraintFailure.tool.restore()).rejects.toThrow('synthetic duplicate rule constraint');
        expect(constraintFailure.harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith(duplicateRows);
        expect(constraintFailure.harness.dependencies.IReserveDB.restore).not.toHaveBeenCalled();

        const { ruleItems: _discarded, ...remaining } = versionlessBackup();
        const duplicateDocument = await readRestore(
            `{"ruleItems":[{"id":1}],"ruleItems":[{"id":2}],${JSON.stringify(remaining).slice(1)}`,
        );
        await duplicateDocument.tool.restore();
        expect(duplicateDocument.harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith([{ id: 2 }]);
    });
});
