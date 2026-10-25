import { execFileSync, spawn } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * [AR-9.18]〜[AR-9.20] The real `scripts/release-preflight.sh` and `scripts/preflight-resources.mjs` decide the
 * container CPU bands, memory limits, chain order and worker counts before any step starts, and pass them to the
 * steps. The steps (`job.sh`, `setup.sh`, the stale-container cleanup, the dependency preparation, node-matrix) and
 * the `docker`, `python3` and `mise` commands are replaced by recording scripts, so the recorded calls are exactly
 * what the real steps would be told. The run is pinned with `taskset` to the first 4 CPUs this process may use, and
 * `EPGS_PREFLIGHT_MEMORY` stands for a machine with 7.5 GiB.
 */

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const GIB = 1024 ** 3;
const MACHINE_MEMORY = 7.5 * GIB;

const allowedCpus = (): number[] => {
    const line = readFileSync('/proc/self/status', 'utf8')
        .split('\n')
        .find(entry => entry.startsWith('Cpus_allowed_list:'));
    if (line === undefined) throw new Error('Cpus_allowed_list is not available');
    return line
        .slice('Cpus_allowed_list:'.length)
        .trim()
        .split(',')
        .flatMap(part => {
            const [first, last = first] = part.split('-').map(Number);
            return Array.from({ length: last - first + 1 }, (_, index) => first + index);
        });
};

const cpuBand = (cpus: number[]): string => {
    const runs: string[] = [];
    let start = cpus[0];
    for (let index = 1; index <= cpus.length; index++) {
        if (index < cpus.length && cpus[index] === cpus[index - 1] + 1) continue;
        const end = cpus[index - 1];
        runs.push(start === end ? `${start}` : `${start}-${end}`);
        start = cpus[index];
    }
    return runs.join(',');
};

const machineCpus = allowedCpus().slice(0, 4);

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

const script = async (path: string, lines: string[]): Promise<void> => {
    await writeFile(path, [...lines, ''].join('\n'));
    await chmod(path, 0o755);
};

let fixture = '';

beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'epgstation-preflight-resources-'));
    for (const directory of ['scripts/server-test', 'scripts/ci-rehearsal', 'bin']) {
        await mkdir(join(fixture, directory), { recursive: true });
    }
    for (const file of ['scripts/release-preflight.sh', 'scripts/preflight-resources.mjs', 'scripts/server-test/worktree-content.mjs']) {
        await cp(join(repositoryRoot, file), join(fixture, file));
    }
    const record = 'echo "$*" >> "$(git rev-parse --show-toplevel)/calls.log"';
    await script(join(fixture, 'scripts/preflight-clean-stale-containers.sh'), ['#!/bin/bash', 'set -- stale-containers', record]);
    await script(join(fixture, 'scripts/ci-rehearsal/setup.sh'), [
        '#!/bin/bash',
        'set -- setup "name=${EPGS_REHEARSAL_NAME:-epgs-runner-rehearsal}" "cpuset=$EPGS_REHEARSAL_CPUSET" "memory=$EPGS_REHEARSAL_MEMORY"',
        record,
    ]);
    // server-check waits until client-static has started, so a run that does not start the chains at once fails it.
    await script(join(fixture, 'scripts/ci-rehearsal/job.sh'), [
        '#!/bin/bash',
        'root=$(git rev-parse --show-toplevel)',
        'step=$3',
        'echo "start $step coverage=${EPGSTATION_COVERAGE_GATE_MAX_WORKERS:-} playwright=${PLAYWRIGHT_WORKERS:-}" >> "$root/calls.log"',
        'if [ "$step" = client-static ]; then touch "$root/client-started"; fi',
        'if [ "$step" = server-check ] && [ "${WAIT_FOR_CLIENT:-}" = 1 ]; then',
        '  for _ in $(seq 1 100); do [ -e "$root/client-started" ] && break; sleep 0.1; done',
        '  [ -e "$root/client-started" ] || exit 1',
        'fi',
        'echo "end $step" >> "$root/calls.log"',
    ]);
    await writeFile(join(fixture, 'scripts/server-test/prepare-dependency-images.mjs'), '');
    await writeFile(
        join(fixture, 'scripts/server-test/run-node-acceptance-matrix.mjs'),
        "import { appendFileSync } from 'node:fs';\n" +
            "appendFileSync('calls.log', `node-matrix workers=${process.env.EPGSTATION_TEST_MAX_WORKERS}\\n`);\n",
    );
    await script(join(fixture, 'bin/docker'), [
        '#!/bin/bash',
        'case "$*" in',
        '  *SecurityOptions*) echo "${FAKE_DOCKER_SECURITY:-[\\"name=seccomp,profile=builtin\\"]}" ;;',
        `  *MemTotal*) echo "${32 * GIB}" ;;`,
        'esac',
    ]);
    await script(join(fixture, 'bin/python3'), ['#!/bin/bash', 'exit 0']);
    await script(join(fixture, 'bin/mise'), ['#!/bin/bash', 'exit 0']);
    await writeFile(join(fixture, '.gitignore'), 'test/server/.artifacts/\ncalls.log\nclient-started\n');
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: fixture, env: gitEnvironment });
    execFileSync('git', ['add', '-A'], { cwd: fixture, env: gitEnvironment });
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: fixture, env: gitEnvironment });
});

afterEach(async () => {
    await rm(fixture, { force: true, recursive: true });
});

interface PreflightSettings {
    readonly EPGS_PREFLIGHT_CPUSET_A?: string;
    readonly EPGS_PREFLIGHT_CPUSET_B?: string;
    readonly EPGS_PREFLIGHT_PARALLEL?: string;
    readonly FAKE_DOCKER_SECURITY?: string;
    readonly WAIT_FOR_CLIENT?: string;
}

const runPreflight = (
    settings: PreflightSettings,
): Promise<{ code: number | null; stderr: string; stdout: string }> =>
    new Promise((resolve, reject) => {
        const child = spawn('taskset', ['-c', cpuBand(machineCpus), 'bash', 'scripts/release-preflight.sh', '--all'], {
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
                PATH: `${join(fixture, 'bin')}:${process.env.PATH}`,
                EPGS_PREFLIGHT_MEMORY: `${MACHINE_MEMORY}`,
                EPGS_PREFLIGHT_CPUSET_A: settings.EPGS_PREFLIGHT_CPUSET_A ?? '',
                EPGS_PREFLIGHT_CPUSET_B: settings.EPGS_PREFLIGHT_CPUSET_B ?? '',
                EPGS_PREFLIGHT_PARALLEL: settings.EPGS_PREFLIGHT_PARALLEL ?? '',
                EPGS_PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS: '',
                EPGS_PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS: '',
                FAKE_DOCKER_SECURITY: settings.FAKE_DOCKER_SECURITY ?? '',
                WAIT_FOR_CLIENT: settings.WAIT_FOR_CLIENT ?? '',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => (stdout += chunk));
        child.stderr.on('data', (chunk: string) => (stderr += chunk));
        child.once('error', reject);
        child.once('close', code => resolve({ code, stderr, stdout }));
    });

const calls = async (): Promise<string[]> => (await readFile(join(fixture, 'calls.log'), 'utf8')).trim().split('\n');

const summary = async (): Promise<string[]> => {
    const root = join(fixture, 'test/server/.artifacts/preflight');
    const [tree] = await readdir(root);
    const [run] = await readdir(join(root, tree));
    return (await readFile(join(root, tree, run, 'summary.tsv'), 'utf8')).trim().split('\n');
};

const callsExist = async (): Promise<boolean> =>
    readFile(join(fixture, 'calls.log'), 'utf8').then(
        () => true,
        () => false,
    );

describe('[AR-9.18] release-preflight.sh passes the decided resources to every step (real script)', () => {
    it('runs the chains one after the other on 4 CPUs and 7.5 GiB, with both containers on the 4 CPUs', async () => {
        const band = cpuBand(machineCpus);

        const { code, stdout } = await runPreflight({});

        expect(code).toBe(0);
        expect(stdout).toContain('ALL PASSED (8 steps)');
        expect(await calls()).toEqual([
            'stale-containers',
            `setup name=epgs-runner-rehearsal cpuset=${band} memory=${MACHINE_MEMORY}`,
            `setup name=epgs-runner-rehearsal-b cpuset=${band} memory=${MACHINE_MEMORY}`,
            'start deps-prepare coverage= playwright=',
            'end deps-prepare',
            'start server-check coverage= playwright=',
            'end server-check',
            'start serialized coverage= playwright=',
            'end serialized',
            'start client-static coverage=4 playwright=4',
            'end client-static',
            'start client-browser coverage=4 playwright=4',
            'end client-browser',
            'node-matrix workers=4',
        ]);
        const lines = await summary();
        expect(lines[1]).toBe(
            `# resources cpus=${band} host-memory=${MACHINE_MEMORY} docker-memory=${MACHINE_MEMORY} chains=serial ` +
                `cpuset-a=${band} cpuset-b=${band} container-memory=${MACHINE_MEMORY} server-workers=4 ` +
                'client-coverage-workers=4 playwright-workers=4 parallel-client-coverage-workers=4 parallel-playwright-workers=2',
        );
        expect(lines.slice(2).map(line => line.split('\t')[3])).toEqual(Array(8).fill('exit=0'));
    }, 60_000);

    it('runs the chains at once on the given disjoint CPU bands, with the parallel worker caps on the client chain', async () => {
        const bandA = cpuBand(machineCpus.slice(0, 2));
        const bandB = cpuBand(machineCpus.slice(2));

        const { code } = await runPreflight({
            EPGS_PREFLIGHT_CPUSET_A: bandA,
            EPGS_PREFLIGHT_CPUSET_B: bandB,
            EPGS_PREFLIGHT_PARALLEL: '1',
            WAIT_FOR_CLIENT: '1',
        });

        expect(code).toBe(0);
        const recorded = await calls();
        expect(recorded.slice(0, 3)).toEqual([
            'stale-containers',
            `setup name=epgs-runner-rehearsal cpuset=${bandA} memory=${MACHINE_MEMORY}`,
            `setup name=epgs-runner-rehearsal-b cpuset=${bandB} memory=${MACHINE_MEMORY}`,
        ]);
        expect(recorded).toContain('start client-static coverage=2 playwright=2');
        expect(recorded).toContain('start client-browser coverage=2 playwright=2');
        expect(recorded.indexOf('start client-static coverage=2 playwright=2')).toBeLessThan(recorded.indexOf('end server-check'));
        expect(recorded.at(-1)).toBe('node-matrix workers=4');
        expect((await summary())[1]).toContain(' chains=parallel ');
    }, 60_000);
});

describe('[AR-9.19] release-preflight.sh starts no step when a CPU band is unusable (real script)', () => {
    it('fails before the first step when container B is given CPUs outside the allowed ones', async () => {
        const outside = Math.max(...allowedCpus()) + 1;

        const { code, stderr } = await runPreflight({ EPGS_PREFLIGHT_CPUSET_B: `${outside}` });

        expect(code).not.toBe(0);
        expect(stderr).toContain(`EPGS_PREFLIGHT_CPUSET_B=${outside} に、使える CPU（${cpuBand(machineCpus)}）の外の CPU があります`);
        expect(await callsExist()).toBe(false);
    }, 60_000);
});

describe('[AR-9.20] release-preflight.sh starts no step when a tool is missing (real script)', () => {
    it('fails before the first step when Docker is rootless', async () => {
        const { code, stderr } = await runPreflight({
            FAKE_DOCKER_SECURITY: '["name=seccomp,profile=builtin","name=rootless"]',
        });

        expect(code).not.toBe(0);
        expect(stderr).toContain('Docker が rootless です。模擬 container は rootful の Docker を要ります');
        expect(await callsExist()).toBe(false);
    }, 60_000);
});
