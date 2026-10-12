import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rehearsalImageDigest } from '../../../../scripts/ci-rehearsal/image-digest.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ARTIFACT_ROOT = join(REPOSITORY_ROOT, 'test/server/.artifacts/image-digest-spec');
const SCRIPT = join(REPOSITORY_ROOT, 'scripts/ci-rehearsal/image-digest.mjs');

const INPUTS = [
    '.github/workflows/server.yml',
    'mise.toml',
    'client/mise.toml',
    'package.json',
    'package-lock.json',
    'client/package.json',
    'client/package-lock.json',
];

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

describe('模擬 runner の image の digest', () => {
    let repository: string;

    beforeEach(async () => {
        await mkdir(ARTIFACT_ROOT, { recursive: true });
        repository = await mkdtemp(join(ARTIFACT_ROOT, 'repo-'));
        git(repository, 'init', '--quiet', '--initial-branch=main');
        for (const input of INPUTS) {
            await mkdir(dirname(join(repository, input)), { recursive: true });
            await writeFile(join(repository, input), `${input}\n`);
        }
        git(repository, 'add', '-A');
        git(repository, 'commit', '--quiet', '-m', 'initial');
    });

    afterEach(async () => {
        await rm(repository, { recursive: true, force: true });
    });

    it('tree を指定すると、作業 directory と同じ内容ならその tree から読んだ digest が一致する', () => {
        const tree = git(repository, 'rev-parse', 'HEAD^{tree}').trim();
        expect(rehearsalImageDigest({ tree, root: repository })).toBe(rehearsalImageDigest({ root: repository }));
    });

    it('tree を指定すると、作業 directory の file を書き換えても digest が変わらない', async () => {
        const tree = git(repository, 'rev-parse', 'HEAD^{tree}').trim();
        const before = rehearsalImageDigest({ tree, root: repository });
        await writeFile(join(repository, 'package-lock.json'), 'rewritten after the tree was fixed\n');
        await writeFile(join(repository, '.github/workflows/server.yml'), 'rewritten\n');
        expect(rehearsalImageDigest({ tree, root: repository })).toBe(before);
        expect(rehearsalImageDigest({ root: repository })).not.toBe(before);
    });

    it('tree に入っていない中身を指定すると、別の digest になる', async () => {
        const original = git(repository, 'rev-parse', 'HEAD^{tree}').trim();
        await writeFile(join(repository, 'client/package-lock.json'), 'changed\n');
        git(repository, 'add', '-A');
        git(repository, 'commit', '--quiet', '-m', 'change a manifest');
        const changed = git(repository, 'rev-parse', 'HEAD^{tree}').trim();
        expect(rehearsalImageDigest({ tree: changed, root: repository })).not.toBe(
            rehearsalImageDigest({ tree: original, root: repository }),
        );
    });

    it('command として --tree に 40 桁の 16 進数でない値を渡すと、digest を出さずに終わる', () => {
        let status = 0;
        let stdout = '';
        try {
            stdout = execFileSync(process.execPath, [SCRIPT, '--tree', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' });
        } catch (error) {
            status = (error as { status: number }).status;
        }
        expect(status).toBe(2);
        expect(stdout).toBe('');
    });
});
