import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { snapshotWorktreeContent } from '../../../../scripts/server-test/worktree-content.mjs';

const execFile = promisify(execFileCallback);

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ARTIFACT_ROOT = join(REPOSITORY_ROOT, 'test/server/.artifacts/worktree-content-spec');
const SCRIPT = join(REPOSITORY_ROOT, 'scripts/server-test/worktree-content.mjs');

/** The identity comes from the environment, never from the user's git configuration. */
const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
};

function git(directory: string, ...arguments_: string[]): string {
    return execFileSync('git', arguments_, { cwd: directory, env: GIT_ENV, encoding: 'utf8' });
}

describe('作業場所の中身の記録', () => {
    let repository: string;

    beforeEach(async () => {
        await mkdir(ARTIFACT_ROOT, { recursive: true });
        repository = await mkdtemp(join(ARTIFACT_ROOT, 'repo-'));
        git(repository, 'init', '--quiet', '--initial-branch=main');
        await writeFile(join(repository, '.gitignore'), 'ignored.txt\n');
        await writeFile(join(repository, 'tracked.txt'), 'one\n');
        git(repository, 'add', '-A');
        git(repository, 'commit', '--quiet', '-m', 'initial');
    });

    afterEach(async () => {
        await rm(repository, { recursive: true, force: true });
    });

    it('clean な作業場所では contentTree が headTree と等しく、未 commit の変更が無い', async () => {
        const reports: string[] = [];
        const record = await snapshotWorktreeContent(repository, { report: message => reports.push(message) });
        const head = git(repository, 'rev-parse', 'HEAD^{tree}').trim();
        expect(record).toEqual({ contentTree: head, headTree: head, uncommittedChanges: false });
        expect(reports).toEqual([]);
    });

    it('追跡中の file を変えると contentTree が変わり、未 commit の変更ありと記録する', async () => {
        const before = await snapshotWorktreeContent(repository);
        await writeFile(join(repository, 'tracked.txt'), 'two\n');
        const after = await snapshotWorktreeContent(repository);
        expect(after.headTree).toBe(before.headTree);
        expect(after.contentTree).not.toBe(before.contentTree);
        expect(after.uncommittedChanges).toBe(true);
    });

    it('index に載せた内容ではなく、作業 file の今の内容が contentTree に入る', async () => {
        await writeFile(join(repository, 'tracked.txt'), 'staged\n');
        git(repository, 'add', 'tracked.txt');
        await writeFile(join(repository, 'tracked.txt'), 'worktree only\n');
        const record = await snapshotWorktreeContent(repository);
        const expected = git(repository, 'hash-object', 'tracked.txt').trim();
        const listing = git(repository, 'ls-tree', record.contentTree as string, 'tracked.txt');
        expect(listing).toContain(expected);
    });

    it('ignore されていない未追跡の file を含み、ignore された file を含まない', async () => {
        await writeFile(join(repository, 'untracked.txt'), 'new\n');
        await writeFile(join(repository, 'ignored.txt'), 'ignored\n');
        const record = await snapshotWorktreeContent(repository);
        const names = git(repository, 'ls-tree', '-r', '--name-only', record.contentTree as string)
            .split('\n')
            .filter(line => line.length > 0);
        expect(names).toContain('untracked.txt');
        expect(names).not.toContain('ignored.txt');
        expect(record.uncommittedChanges).toBe(true);
    });

    it('同じ中身なら commit のし直しや作業の順に依らず同じ contentTree になる', async () => {
        await writeFile(join(repository, 'tracked.txt'), 'two\n');
        const uncommitted = await snapshotWorktreeContent(repository);
        git(repository, 'add', '-A');
        git(repository, 'commit', '--quiet', '-m', 'second');
        const committed = await snapshotWorktreeContent(repository);
        expect(committed.contentTree).toBe(uncommitted.contentTree);
        expect(committed.headTree).toBe(committed.contentTree);
        expect(committed.uncommittedChanges).toBe(false);
    });

    it('実行の前後で git status と index と ref が変わらず、一時 index を残さない', async () => {
        await writeFile(join(repository, 'tracked.txt'), 'two\n');
        await writeFile(join(repository, 'untracked.txt'), 'new\n');
        git(repository, 'add', 'tracked.txt');
        const statusBefore = git(repository, 'status', '--porcelain=v1', '--untracked-files=all');
        const indexBefore = await readFile(join(repository, '.git/index'));
        const refsBefore = git(repository, 'for-each-ref');
        const headBefore = git(repository, 'rev-parse', 'HEAD');

        await snapshotWorktreeContent(repository);

        expect(git(repository, 'status', '--porcelain=v1', '--untracked-files=all')).toBe(statusBefore);
        expect((await readFile(join(repository, '.git/index'))).equals(indexBefore)).toBe(true);
        expect(git(repository, 'for-each-ref')).toBe(refsBefore);
        expect(git(repository, 'rev-parse', 'HEAD')).toBe(headBefore);
        const leftovers = await readdir(join(repository, 'test/server/.artifacts/worktree-content')).catch(() => []);
        expect(leftovers).toEqual([]);
    });

    it('test/server/.artifacts/ を ignore している repository でも contentTree を求められ、artifact の file を含まない', async () => {
        await writeFile(join(repository, '.gitignore'), 'ignored.txt\ntest/server/.artifacts/\n');
        await mkdir(join(repository, 'test/server/.artifacts/other'), { recursive: true });
        await writeFile(join(repository, 'test/server/.artifacts/other/artifact.txt'), 'artifact\n');
        const record = await snapshotWorktreeContent(repository);
        expect(record.contentTree).not.toBeNull();
        const names = git(repository, 'ls-tree', '-r', '--name-only', record.contentTree as string)
            .split('\n')
            .filter(line => line.length > 0);
        expect(names.some(name => name.startsWith('test/server/.artifacts/'))).toBe(false);
        expect(names).toContain('.gitignore');
    });

    it('一時 index の置き場所は contentTree に入らない', async () => {
        const record = await snapshotWorktreeContent(repository);
        const names = git(repository, 'ls-tree', '-r', '--name-only', record.contentTree as string);
        expect(names).not.toContain('.artifacts');
    });

    it('git の repository でなければ各 field が null になる', async () => {
        const plain = await mkdtemp(join(ARTIFACT_ROOT, 'plain-'));
        try {
            await writeFile(join(plain, 'a.txt'), 'a\n');
            const reports: string[] = [];
            const record = await snapshotWorktreeContent(plain, { report: message => reports.push(message) });
            expect(record).toEqual({ contentTree: null, headTree: null, uncommittedChanges: null });
            expect(reports).toHaveLength(1);
            expect(reports[0]).toContain('git rev-parse --verify --quiet HEAD^{tree} failed');
        } finally {
            await rm(plain, { recursive: true, force: true });
        }
    });

    it('HEAD に commit が無ければ headTree と uncommittedChanges が null になる', async () => {
        const empty = await mkdtemp(join(ARTIFACT_ROOT, 'empty-'));
        try {
            git(empty, 'init', '--quiet', '--initial-branch=main');
            await writeFile(join(empty, 'a.txt'), 'a\n');
            const reports: string[] = [];
            const record = await snapshotWorktreeContent(empty, { report: message => reports.push(message) });
            expect(record.headTree).toBeNull();
            expect(record.uncommittedChanges).toBeNull();
            expect(reports).toHaveLength(1);
            expect(reports[0]).toContain('git rev-parse --verify --quiet HEAD^{tree} failed');
        } finally {
            await rm(empty, { recursive: true, force: true });
        }
    });

    it('一時 index を置く場所を作れなければ contentTree が null になり、その原因を report する', async () => {
        // `test` is a file, so the scratch directory `test/server/.artifacts/worktree-content` cannot be created.
        await writeFile(join(repository, 'test'), 'not a directory\n');
        git(repository, 'add', '-A');
        git(repository, 'commit', '--quiet', '-m', 'test is a file');
        const reports: string[] = [];
        const record = await snapshotWorktreeContent(repository, { report: message => reports.push(message) });
        expect(record.contentTree).toBeNull();
        expect(record.uncommittedChanges).toBeNull();
        expect(reports).toHaveLength(1);
        expect(reports[0]).toContain('scratch directory');
        expect(reports[0]).toMatch(/ENOTDIR|EEXIST/u);
    });

    it('git の command が失敗したら、その command と git の stderr の先頭を report する', async () => {
        // `git add -A` cannot read this file, so it fails after HEAD^{tree} has been resolved.
        const unreadable = join(repository, 'unreadable.txt');
        await writeFile(unreadable, 'secret\n');
        await chmod(unreadable, 0o000);
        const reports: string[] = [];
        const record = await snapshotWorktreeContent(repository, { report: message => reports.push(message) });
        expect(record.headTree).not.toBeNull();
        expect(record.contentTree).toBeNull();
        expect(record.uncommittedChanges).toBeNull();
        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatch(/^git add -A failed: .*unreadable\.txt/u);
    });

    it('command として実行すると contentTree を 1 行で出力する', async () => {
        await writeFile(join(repository, 'tracked.txt'), 'two\n');
        const { stdout } = await execFile(process.execPath, [SCRIPT], { cwd: repository, env: GIT_ENV });
        const record = await snapshotWorktreeContent(repository);
        expect(stdout).toBe(`${record.contentTree}\n`);
    });

    it('command として実行して contentTree を求められなければ非 0 で終わり、何も出力しない', async () => {
        const plain = await mkdtemp(join(ARTIFACT_ROOT, 'plain-'));
        try {
            const result = await execFile(process.execPath, [SCRIPT], { cwd: plain, env: GIT_ENV }).then(
                () => ({ code: 0, stdout: '', stderr: '' }),
                (error: { code: number; stdout: string; stderr: string }) => ({
                    code: error.code,
                    stdout: error.stdout,
                    stderr: error.stderr,
                }),
            );
            expect(result.code).not.toBe(0);
            expect(result.stdout).toBe('');
            expect(result.stderr).toContain('worktree-content: git rev-parse --verify --quiet HEAD^{tree} failed');
            expect(result.stderr).toContain('could not be computed');
        } finally {
            await rm(plain, { recursive: true, force: true });
        }
    });
});
