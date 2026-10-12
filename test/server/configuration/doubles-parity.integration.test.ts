import 'reflect-metadata';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig } from '../media-delivery/_media-harness';

/*
 * 他の component の test が使う設定の偽物（media-delivery の baseConfig）が、本物の Configuration が
 * 既定値で補完した設定と同じ key・型・構造を持つことを確かめる。
 */

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('Server test runner did not provide its compiled snapshot');
}

const require = createRequire(join(repositoryRoot, 'package.json'));
const Configuration = (
    require(join(compiledSnapshot, 'model', 'Configuration.js')) as {
        default: new (
            logger: { getLogger(): Record<string, unknown> },
            access: Record<string, unknown>,
        ) => { getConfig(): Record<string, any> };
    }
).default;

const templatePath = join(repositoryRoot, 'config', 'config.yml.template');
const temporaryDirectories: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        await rm(directory, { force: true, recursive: true });
    }
});

const loadRealConfig = async (): Promise<Record<string, any>> => {
    const directory = await mkdtemp(join(tmpdir(), 'epgstation-config-parity-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, 'config.yml');
    await writeFile(
        configPath,
        [
            'port: 8888',
            "recorded: [{ name: 'parity', path: '%ROOT%/recorded' }]",
            "thumbnail: '%ROOT%/thumbnail'",
            "streamFilePath: '%ROOT%/streamfiles'",
            'stream: { live: { ts: {} }, recorded: { ts: {}, encoded: {} } }',
            '',
        ].join('\n'),
        'utf8',
    );
    const logger = {
        getLogger: () => ({
            stream: { warn: vi.fn() },
            system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
        }),
    };
    const access = {
        configPath,
        templatePath,
        readSync: (path: string) => readFileSync(path, 'utf8'),
        read: async (path: string) => readFileSync(path, 'utf8'),
        watch: vi.fn(),
        unwatch: vi.fn(),
    };
    return new Configuration(logger, access).getConfig();
};

const describeShape = (value: unknown): string => {
    if (Array.isArray(value)) {
        return 'array';
    }
    return value === null ? 'null' : typeof value;
};

describe('configuration double parity', () => {
    it('[CFG-DOUBLE-PARITY-BASECONFIG] keeps every top-level key and type of the media-delivery config double in the real default-completed configuration', async () => {
        const real = await loadRealConfig();
        const fake = baseConfig();

        for (const [key, value] of Object.entries(fake)) {
            expect(Object.keys(real), `real configuration lacks ${key}`).toContain(key);
            expect(describeShape(real[key]), `type of ${key}`).toBe(describeShape(value));
        }
    });

    it('[CFG-DOUBLE-PARITY-BASECONFIG] keeps the stream command tree of the double inside the real default stream command tree', async () => {
        const real = await loadRealConfig();
        const fake = baseConfig();
        expect(real.stream.live.ts.m2ts.some((entry: { cmd?: string }) => entry.cmd === undefined)).toBe(true);
        expect(fake.stream.live.ts.m2ts.some((entry: { cmd?: string }) => entry.cmd === undefined)).toBe(true);

        for (const [source, sourceValue] of Object.entries<Record<string, any>>(fake.stream)) {
            for (const [content, contentValue] of Object.entries<Record<string, any>>(sourceValue)) {
                for (const [format, entries] of Object.entries<unknown[]>(contentValue)) {
                    const path = `stream.${source}.${content}.${format}`;
                    const realEntries = real.stream?.[source]?.[content]?.[format];
                    expect(Array.isArray(realEntries), `${path} must be an array in the real configuration`).toBe(true);
                    expect(realEntries.length, `${path} must have commands`).toBeGreaterThan(0);
                    expect(Array.isArray(entries)).toBe(true);
                    for (const realEntry of realEntries) {
                        // 「無変換」の項目は cmd を持たない。double の `{}` はこの形に対応する。
                        expect(['string', 'undefined'], `${path} entries carry an optional cmd string`).toContain(
                            typeof realEntry.cmd,
                        );
                        expect(typeof realEntry.name, `${path} entries carry a name string`).toBe('string');
                    }
                }
            }
        }
    });

    it('[CFG-DOUBLE-PARITY-BASECONFIG] gives the scalar keys the double relies on a real default', async () => {
        const real = await loadRealConfig();
        for (const key of ['encodeProcessNum', 'ffmpeg', 'ffprobe', 'streamFilePath', 'streamingPriority']) {
            expect(real[key], `${key} must have a real default`).not.toBeUndefined();
        }
    });
});
