import 'reflect-metadata';

import { access as fsAccess, chmod, cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { cleanInstallProbeTimeoutMs, runNode, runNpm } from '../harness/clean-install-process';

/*
 * Requirement 1.4 の canonical 契約: Mirakurun 専用 client package なしで、clean な directory に本物の `npm ci` と
 * `tsc` を流して build でき、production の import graph に package が残らず、公開の status transport が直接 HTTP の
 * ままであること。本物の install と compile が中身なので、他の重い test と並行すると所要時間が伸びる。そのため
 * この file は直列実行の一覧（`scripts/server-test/serialized-real-process-files.mjs`）に載せ、全層の run では
 * 並列 batch の後に単独で流す。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;

const access = (transport: Record<string, unknown>) =>
    new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport, {});
const statusTransport = (current = '3.8.0') => ({
    getBuffer: vi.fn(),
    getJson: vi.fn(async (path: string) => (path === '/api/status' ? {} : { current, latest: '9.7.5' })),
});

const makeTestOwnedDirectoriesTraversable = async (root: string): Promise<void> => {
    await chmod(root, 0o700);
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        await makeTestOwnedDirectoriesTraversable(join(root, entry.name));
    }
};

describe('tuner access clean install', () => {
    it(
        '[TA-AC-1.4] builds without the dedicated client package and keeps the public status transport direct',
        async () => {
            const cleanRoot = await mkdtemp(join(tmpdir(), 'epgstation-tuner-clean-install-'));
            const transport = statusTransport();
            try {
                await Promise.all([
                    cp('api.d.ts', join(cleanRoot, 'api.d.ts')),
                    cp('src', join(cleanRoot, 'src'), { recursive: true }),
                    cp('package.json', join(cleanRoot, 'package.json')),
                    cp('package-lock.json', join(cleanRoot, 'package-lock.json')),
                    cp('tsconfig.json', join(cleanRoot, 'tsconfig.json')),
                ]);
                await runNpm(cleanRoot, [
                    'ci',
                    '--ignore-scripts',
                    '--no-audit',
                    '--fund=false',
                    '--no-progress',
                    '--no-update-notifier',
                    '--prefer-offline',
                ]);
                await runNpm(cleanRoot, ['run', 'compile']);
                await expect(fsAccess(join(cleanRoot, 'node_modules', 'mirakurun'))).rejects.toMatchObject({
                    code: 'ENOENT',
                });
                const resolvedGraph = JSON.parse(
                    await runNode(
                        cleanRoot,
                        [
                            "const Module = require('node:module');",
                            'const resolved = [];',
                            'const originalResolveFilename = Module._resolveFilename;',
                            'Module._resolveFilename = function(request) {',
                            '  const value = originalResolveFilename.apply(this, arguments);',
                            '  resolved.push([request, value]);',
                            '  return value;',
                            '};',
                            "require('reflect-metadata');",
                            "require('./dist/model/ModelContainerSetter.js');",
                            'process.stdout.write(JSON.stringify(resolved));',
                        ].join('\n'),
                    ),
                ) as Array<[string, string]>;
                expect(resolvedGraph).toEqual(
                    expect.arrayContaining([
                        expect.arrayContaining([expect.stringMatching(/[\\/]model[\\/]ModelContainerSetter\.js$/u)]),
                    ]),
                );
                expect(resolvedGraph.map(([request]) => request)).not.toEqual(
                    expect.arrayContaining([expect.stringMatching(/^mirakurun(?:\/|$)/u)]),
                );
                expect(resolvedGraph.map(([, resolved]) => resolved)).not.toEqual(
                    expect.arrayContaining([expect.stringMatching(/[\\/]node_modules[\\/]mirakurun(?:[\\/]|$)/u)]),
                );
                await expect(access(transport).getStatus()).resolves.toEqual({
                    available: true,
                    version: { current: '3.8.0', latest: '9.7.5' },
                });
                expect(transport.getJson).toHaveBeenNthCalledWith(1, '/api/status', {
                    signal: expect.any(AbortSignal),
                });
                expect(transport.getJson).toHaveBeenNthCalledWith(2, '/api/version', {
                    signal: expect.any(AbortSignal),
                });
            } finally {
                await makeTestOwnedDirectoriesTraversable(cleanRoot);
                await rm(cleanRoot, { force: true, recursive: true });
            }
        },
        cleanInstallProbeTimeoutMs,
    );
});
