import 'reflect-metadata';

import { mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface FileAccess {
    readonly configPath: string;
    read(targetPath: string): Promise<string>;
    readSync(targetPath: string): string;
    readonly templatePath: string;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ConfigurationFileAccess = (
    require(join(compiledSnapshot, 'model', 'ConfigurationFileAccess.js')) as { default: new () => FileAccess }
).default;

describe('configuration file access on real files', () => {
    it('[CFG-8.2] points at the config directory two levels above the compiled model directory', () => {
        const access = new ConfigurationFileAccess();
        const modelDirectory = join(compiledSnapshot, 'model');

        expect(access.configPath).toBe(join(modelDirectory, '..', '..', 'config', 'config.yml'));
        expect(access.templatePath).toBe(join(modelDirectory, '..', '..', 'config', 'config.yml.template'));
    });

    it('[CFG-8.2] reads a UTF-8 file as text, synchronously and asynchronously', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'epgstation-config-access-'));
        const target = join(directory, 'synthetic-config.yml');
        await writeFile(target, 'name: 設定\n', 'utf-8');
        const access = new ConfigurationFileAccess();

        const sync = access.readSync(target);
        const async = await access.read(target);

        expect(typeof sync).toBe('string');
        expect(sync).toBe('name: 設定\n');
        expect(typeof async).toBe('string');
        expect(async).toBe('name: 設定\n');
    });
});
