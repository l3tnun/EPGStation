import { describe, expect, it, vi } from 'vitest';
import { loadTool, makeDependencies, ProcessExit, withProcess } from './_harness';

describe('management CLI characterization', () => {
    it.each([
        ['MT-1.4', [], '引数が足りません'],
        ['invalid DBTools input', ['--mode', 'backup'], '引数が足りません'],
        ['invalid DBTools input', ['--mode', '', '--output', 'synthetic-output'], '引数が足りません'],
        ['invalid DBTools input', ['--mode', 'backup', '--output', ''], '引数が足りません'],
        ['MT-1.5', ['--mode', 'unknown', '--output', 'synthetic-output'], 'mode の指定が間違っています'],
    ])('[%s] rejects invalid DBTools input before container initialization', async (_caseName, argv, message) => {
        const harness = makeDependencies();
        const filesystem = { readFileSync: vi.fn(), writeFileSync: vi.fn() };
        const Tool = await loadTool('DBTools.js', harness.container, filesystem);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(withProcess(argv, () => new Tool())).rejects.toEqual(new ProcessExit(1));
            expect(error).toHaveBeenCalledWith(message);
            expect(harness.container.get).not.toHaveBeenCalled();
            expect(filesystem.readFileSync).not.toHaveBeenCalled();
        } finally {
            error.mockRestore();
        }
    });

    it.each([
        ['MT-1.1', 'backup', ['-m', 'backup', '-o', 'synthetic-output', 'synthetic-extra']],
        ['MT-1.2', 'restore', ['--mode', 'restore', '--output', 'synthetic-input', '--synthetic-extra']],
        ['MT-1.3', 'v1migrate', ['-i', 'synthetic-v1-input', 'synthetic-extra']],
    ])('[%s] accepts the %s command and aliases', async (_caseName, kind, argv) => {
        const harness = makeDependencies();
        const filesystem = { readFileSync: vi.fn(() => '{}'), writeFileSync: vi.fn() };
        const Tool = await loadTool(
            kind === 'v1migrate' ? 'V1MigrationTool.js' : 'DBTools.js',
            harness.container,
            filesystem,
        );
        await withProcess(argv, () => new Tool());
        expect(harness.dependencies.ILoggerModel.initialize).toHaveBeenCalledOnce();
    });
});
