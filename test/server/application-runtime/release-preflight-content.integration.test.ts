import { execFileSync, spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * [AR-9.17] `scripts/release-preflight.sh` fixes the content it verifies when it starts and uses that one
 * tree for every step, however the work place changes while the steps run. The real script runs in a real
 * git repository with the real `worktree-content.mjs`. The two steps use the lookalike runner container
 * only through `scripts/ci-rehearsal/job.sh` and the image preparation script, which are replaced here by
 * recording scripts (this environment has no runner container to start); the tree each step receives is
 * exactly what the container would be told to check out.
 */

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const gitEnvironment = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
};

const git = (directory: string, ...arguments_: string[]): string =>
    execFileSync('git', arguments_, { cwd: directory, encoding: 'utf8', env: gitEnvironment });

const worktreeContentTree = (directory: string): string =>
    execFileSync(process.execPath, ['scripts/server-test/worktree-content.mjs'], { cwd: directory, encoding: 'utf8' }).trim();

let fixture = '';

beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'epgstation-preflight-content-'));
    await mkdir(join(fixture, 'scripts', 'server-test'), { recursive: true });
    await mkdir(join(fixture, 'scripts', 'ci-rehearsal'), { recursive: true });
    await cp(join(repositoryRoot, 'scripts', 'release-preflight.sh'), join(fixture, 'scripts', 'release-preflight.sh'));
    await cp(
        join(repositoryRoot, 'scripts', 'server-test', 'worktree-content.mjs'),
        join(fixture, 'scripts', 'server-test', 'worktree-content.mjs'),
    );
    await writeFile(join(fixture, '.gitignore'), 'test/server/.artifacts/\n');
    await writeFile(join(fixture, 'tracked.txt'), 'committed\n');
    // The first runner call (deps-prepare) rewrites a tracked file while the run is in progress.
    await writeFile(
        join(fixture, 'scripts', 'ci-rehearsal', 'job.sh'),
        [
            '#!/bin/bash',
            'echo "$1 $3" >> "$(dirname "$0")/../../runner-calls.log"',
            'if [ "$3" = deps-prepare ]; then echo "rewritten during the run" > tracked.txt; fi',
            'exit 0',
            '',
        ].join('\n'),
    );
    await chmod(join(fixture, 'scripts', 'ci-rehearsal', 'job.sh'), 0o755);
    await writeFile(join(fixture, 'scripts', 'server-test', 'prepare-dependency-images.mjs'), '');
    git(fixture, 'init', '--quiet', '--initial-branch=main');
    git(fixture, 'add', '-A');
    git(fixture, 'commit', '--quiet', '-m', 'initial');
});

afterEach(async () => {
    await rm(fixture, { force: true, recursive: true });
});

const runPreflight = (): Promise<{ code: number | null; stdout: string }> =>
    new Promise((resolve, reject) => {
        const child = spawn('bash', ['scripts/release-preflight.sh', '--only', 'deps-prepare', '--only', 'server-check'], {
            cwd: fixture,
            env: {
                ...process.env,
                GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
                GIT_AUTHOR_NAME: 'fixture',
                GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
                GIT_COMMITTER_NAME: 'fixture',
                GIT_CONFIG_GLOBAL: '/dev/null',
                GIT_CONFIG_NOSYSTEM: '1',
                GIT_CONFIG_SYSTEM: '/dev/null',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => (stdout += chunk));
        child.once('error', reject);
        child.once('close', code => resolve({ code, stdout }));
    });

describe('[AR-9.17] release-preflight.sh verifies the content fixed when it started, in every step (real script)', () => {
    it('passes the same tree to both steps and records it in every summary row, although a tracked file changes mid-run', async () => {
        // An uncommitted change exists before the run starts, so the verified content differs from HEAD.
        await writeFile(join(fixture, 'tracked.txt'), 'uncommitted before the run\n');
        await writeFile(join(fixture, 'untracked.txt'), 'new file\n');
        const startContent = worktreeContentTree(fixture);
        const headTree = git(fixture, 'rev-parse', 'HEAD^{tree}').trim();
        expect(startContent).not.toBe(headTree);

        const { code, stdout } = await runPreflight();
        expect(code).toBe(0);
        expect(stdout).toContain('ALL PASSED (2 steps)');

        // The tracked file changed while the first step ran, so a later look at the work place differs.
        expect(await readFile(join(fixture, 'tracked.txt'), 'utf8')).toBe('rewritten during the run\n');
        expect(worktreeContentTree(fixture)).not.toBe(startContent);

        // Both runner calls were told the tree fixed at the start (not HEAD, not the rewritten content).
        expect((await readFile(join(fixture, 'runner-calls.log'), 'utf8')).trim().split('\n')).toEqual([
            `tree:${startContent} deps-prepare`,
            `tree:${startContent} server-check`,
        ]);

        // The summary lives under the start tree's first 12 characters and records the start content.
        const treeDirectories = await readdir(join(fixture, 'test', 'server', '.artifacts', 'preflight'));
        expect(treeDirectories).toEqual([startContent.slice(0, 12)]);
        const [runDirectory] = await readdir(join(fixture, 'test', 'server', '.artifacts', 'preflight', treeDirectories[0]));
        const summary = (
            await readFile(
                join(fixture, 'test', 'server', '.artifacts', 'preflight', treeDirectories[0], runDirectory, 'summary.tsv'),
                'utf8',
            )
        )
            .trim()
            .split('\n');
        expect(summary[0]).toBe(`# candidate=${startContent} head-tree=${headTree} uncommitted-changes=yes`);
        const rows = summary.slice(1).map(row => row.split('\t'));
        expect(rows.map(row => row[2])).toEqual(['deps-prepare', 'server-check']);
        for (const row of rows) {
            expect(row[3]).toBe('exit=0');
            expect(row[4]).toBe(`tree=${startContent}`);
        }
    }, 60_000);

    it('records uncommitted-changes=no and the HEAD tree when the work place is clean', async () => {
        const headTree = git(fixture, 'rev-parse', 'HEAD^{tree}').trim();
        expect(worktreeContentTree(fixture)).toBe(headTree);

        const { code } = await runPreflight();
        expect(code).toBe(0);

        const preflightRoot = join(fixture, 'test', 'server', '.artifacts', 'preflight', headTree.slice(0, 12));
        const [runDirectory] = await readdir(preflightRoot);
        const summary = (await readFile(join(preflightRoot, runDirectory, 'summary.tsv'), 'utf8')).trim().split('\n');
        expect(summary[0]).toBe(`# candidate=${headTree} head-tree=${headTree} uncommitted-changes=no`);
    }, 60_000);
});
