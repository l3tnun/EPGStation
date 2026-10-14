import { execFileSync, spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * [AR-1.5] 依存関係導入と構築の npm script は、Node.js の version 管理 tool（mise など）が無い環境でも動く。
 * 本物の `package.json` を fixture へ写し、本物の npm で script を起動する。script が呼ぶ `npm` は、PATH の先頭に置いた
 * 記録用の script に置き換える（呼ばれた directory と引数だけを記録し、実際の install・build はしない）。PATH には
 * それと `/usr/bin`・`/bin` だけを置き、mise を見つけられないことを先に確かめる。
 */

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const systemPath = '/usr/bin:/bin';

let fixture = '';
let project = '';
let recorderDirectory = '';
let callLog = '';

const runScript = (script: string): Promise<{ code: number | null; output: string }> =>
    new Promise((resolve, reject) => {
        const npmCli = process.env.npm_execpath;
        if (npmCli === undefined) {
            reject(new Error('The npm CLI path is required to run the package scripts'));
            return;
        }
        const child = spawn(process.execPath, [npmCli, 'run', script], {
            cwd: project,
            env: {
                ...process.env,
                HOME: fixture,
                PATH: `${recorderDirectory}:${systemPath}`,
                npm_config_update_notifier: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', chunk => (output += String(chunk)));
        child.stderr.on('data', chunk => (output += String(chunk)));
        child.once('error', reject);
        child.once('close', code => resolve({ code, output }));
    });

const recordedCalls = async (): Promise<string[]> =>
    (await readFile(callLog, 'utf8').catch(() => '')).split('\n').filter(line => line !== '');

beforeEach(async () => {
    // 記録用の npm が残す `$PWD` は symlink を解決した path なので、期待値もそれに揃える。
    fixture = await realpath(await mkdtemp(join(tmpdir(), 'epgstation-install-build-scripts-')));
    project = join(fixture, 'project');
    recorderDirectory = join(fixture, 'bin');
    callLog = join(fixture, 'npm-calls.log');
    await mkdir(join(project, 'client'), { recursive: true });
    await mkdir(recorderDirectory);
    await copyFile(join(repositoryRoot, 'package.json'), join(project, 'package.json'));
    await writeFile(join(project, 'client', 'package.json'), '{}\n');
    await writeFile(
        join(recorderDirectory, 'npm'),
        ['#!/bin/sh', `printf '%s %s\\n' "$PWD" "$*" >> '${callLog}'`, 'exit 0', ''].join('\n'),
    );
    await chmod(join(recorderDirectory, 'npm'), 0o755);
});

afterEach(async () => {
    await rm(fixture, { force: true, recursive: true });
});

describe('install and build package scripts', () => {
    it('[AR-1.5] runs without a Node.js version manager on the PATH', async () => {
        expect(() =>
            execFileSync('/bin/sh', ['-c', 'command -v mise'], {
                env: { ...process.env, PATH: `${recorderDirectory}:${systemPath}` },
                stdio: 'ignore',
            }),
        ).toThrow();

        const results = [];
        for (const script of ['all-install', 'build-server', 'build-client', 'build']) {
            results.push({ script, ...(await runScript(script)) });
        }

        expect(results.map(({ code, script }) => ({ code, script }))).toEqual([
            { code: 0, script: 'all-install' },
            { code: 0, script: 'build-server' },
            { code: 0, script: 'build-client' },
            { code: 0, script: 'build' },
        ]);
        expect(results.map(({ output }) => output).join('\n')).not.toMatch(/not found/u);
        const client = join(project, 'client');
        await expect(recordedCalls()).resolves.toEqual([
            `${project} i --no-save`,
            `${client} i --no-save`,
            `${project} run lint:src`,
            `${project} run format`,
            `${project} run compile`,
            `${client} run build`,
            `${project} run build-server`,
            `${project} run build-client`,
        ]);
    }, 60_000);
});
