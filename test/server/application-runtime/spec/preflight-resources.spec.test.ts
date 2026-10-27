import { describe, expect, it } from 'vitest';

import {
    detectResources,
    missingTools,
    planPreflightResources,
    planRecord,
    planShellAssignments,
} from '../../../../scripts/preflight-resources.mjs';

/**
 * `scripts/preflight-resources.mjs` decides, before any preflight step starts, which CPUs and how much memory the
 * lookalike runner containers get, whether the two container chains run at the same time, and how many test workers
 * each step uses (design §12.3.4). These cases give the decision the CPUs and memory of a synthetic machine.
 */

const GIB = 1024 ** 3;

const range = (first: number, last: number): number[] =>
    Array.from({ length: last - first + 1 }, (_, index) => first + index);

type Machine = { cpus: number[]; cores?: number[][]; hostMemory: number; dockerMemory: number };

const plan = (machine: Machine, env: Record<string, string> = {}) => {
    const result = planPreflightResources(machine, env);
    if (!result.ok) throw new Error(`unexpected failure: ${result.errors.join(' / ')}`);
    return result.plan;
};

const failure = (machine: Machine, env: Record<string, string> = {}): string[] => {
    const result = planPreflightResources(machine, env);
    if (result.ok) throw new Error('unexpected success');
    return result.errors;
};

// 8 core・16 thread の機械で、CPU i と i+8 が同じ物理 core の thread であるときの core の組。
const smtCores = range(0, 7).map(core => [core, core + 8]);

describe('[AR-9.18] preflight resources are decided from the CPUs and memory of the machine it runs on', () => {
    it('runs the chains at once on 8 cores with SMT, keeping container B off the cores of container A and one Playwright worker per core', () => {
        expect(plan({ cpus: range(0, 15), cores: smtCores, hostMemory: 18 * GIB, dockerMemory: 30 * GIB })).toEqual({
            cpus: '0-15',
            hostMemory: 18 * GIB,
            dockerMemory: 30 * GIB,
            parallel: true,
            cpusetA: '0-3',
            cpusetB: '4-7,12-15',
            cpusetBrowser: '0-15',
            containerMemory: 16 * GIB,
            serverWorkers: 16,
            clientCoverageWorkers: 8,
            parallelClientCoverageWorkers: 4,
            playwrightWorkers: 8,
        });
    });

    it('gives container B every CPU after container A when each CPU is its own core, capping Playwright at 8 workers', () => {
        expect(plan({ cpus: range(0, 15), hostMemory: 32 * GIB, dockerMemory: 32 * GIB })).toMatchObject({
            parallel: true,
            cpusetA: '0-3',
            cpusetB: '4-15',
            cpusetBrowser: '0-15',
            containerMemory: 16 * GIB,
            playwrightWorkers: 8,
        });
    });

    it('caps Playwright at 8 workers on more than 8 cores with SMT', () => {
        // 16 core・32 thread の機械で、CPU i と i+16 が同じ物理 core の thread であるときの core の組。
        const cores = range(0, 15).map(core => [core, core + 16]);
        expect(plan({ cpus: range(0, 31), cores, hostMemory: 64 * GIB, dockerMemory: 64 * GIB })).toMatchObject({
            cpusetBrowser: '0-31',
            containerMemory: 16 * GIB,
            playwrightWorkers: 8,
        });
        expect(
            plan({
                cpus: range(0, 17),
                cores: range(0, 8).map(core => [core, core + 9]),
                hostMemory: 64 * GIB,
                dockerMemory: 64 * GIB,
            }),
        ).toMatchObject({ playwrightWorkers: 8 });
    });

    it('runs the chains at once on 8 cores and gives client-browser all 8 CPUs', () => {
        expect(plan({ cpus: range(0, 7), hostMemory: 32 * GIB, dockerMemory: 32 * GIB })).toMatchObject({
            parallel: true,
            cpusetA: '0-3',
            cpusetB: '4-7',
            cpusetBrowser: '0-7',
            containerMemory: 16 * GIB,
            serverWorkers: 8,
            clientCoverageWorkers: 8,
            parallelClientCoverageWorkers: 4,
            playwrightWorkers: 8,
        });
    });

    it('runs the chains one after the other when every core is shared with container A', () => {
        const cores = range(0, 3).map(core => [core, core + 4]);
        expect(plan({ cpus: range(0, 7), cores, hostMemory: 32 * GIB, dockerMemory: 32 * GIB })).toMatchObject({
            parallel: false,
            cpusetA: '0-3',
            cpusetB: '0-7',
            cpusetBrowser: '0-7',
            playwrightWorkers: 4,
        });
    });

    it('runs the chains one after the other on 4 CPUs and 7.5 GiB, sharing the CPUs and capping workers by memory', () => {
        expect(plan({ cpus: range(0, 3), hostMemory: 7.5 * GIB, dockerMemory: 7.5 * GIB })).toMatchObject({
            parallel: false,
            cpusetA: '0-3',
            cpusetB: '0-3',
            cpusetBrowser: '0-3',
            containerMemory: 7.5 * GIB,
            serverWorkers: 4,
            clientCoverageWorkers: 4,
            parallelClientCoverageWorkers: 4,
            playwrightWorkers: 4,
        });
    });

    it('runs the chains one after the other when Docker has less than 24 GiB, even with 16 CPUs', () => {
        expect(plan({ cpus: range(0, 15), hostMemory: 32 * GIB, dockerMemory: 24 * GIB - 1 })).toMatchObject({
            parallel: false,
            cpusetA: '0-3',
            cpusetB: '0-15',
            containerMemory: 16 * GIB,
        });
        expect(plan({ cpus: range(0, 15), hostMemory: 32 * GIB, dockerMemory: 24 * GIB })).toMatchObject({
            parallel: true,
        });
        expect(plan({ cpus: range(0, 6), hostMemory: 32 * GIB, dockerMemory: 32 * GIB })).toMatchObject({
            parallel: false,
        });
    });

    it('assigns CPUs in number order when the allowed CPUs are not contiguous', () => {
        expect(
            plan({ cpus: [14, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13], hostMemory: 32 * GIB, dockerMemory: 32 * GIB }),
        ).toMatchObject({
            cpus: '2-3,5-14',
            parallel: true,
            cpusetA: '2-3,5-6',
            cpusetB: '7-14',
            cpusetBrowser: '2-3,5-14',
        });
    });

    it('caps the server test workers by host memory and by the allowed CPUs', () => {
        expect(plan({ cpus: range(0, 15), hostMemory: 7 * GIB, dockerMemory: 32 * GIB }).serverWorkers).toBe(8);
        expect(plan({ cpus: range(0, 15), hostMemory: 8 * GIB, dockerMemory: 32 * GIB }).serverWorkers).toBe(9);
        expect(plan({ cpus: range(0, 15), hostMemory: 11 * GIB, dockerMemory: 32 * GIB }).serverWorkers).toBe(13);
        expect(plan({ cpus: range(0, 3), hostMemory: 64 * GIB, dockerMemory: 64 * GIB }).serverWorkers).toBe(4);
    });

    it('lowers both memories to EPGS_PREFLIGHT_MEMORY and never raises them', () => {
        expect(
            plan({ cpus: range(0, 15), hostMemory: 32 * GIB, dockerMemory: 32 * GIB }, { EPGS_PREFLIGHT_MEMORY: '8g' }),
        ).toMatchObject({
            hostMemory: 8 * GIB,
            dockerMemory: 8 * GIB,
            parallel: false,
            containerMemory: 8 * GIB,
            serverWorkers: 9,
            clientCoverageWorkers: 8,
            playwrightWorkers: 7,
        });
        expect(
            plan({ cpus: range(0, 3), hostMemory: 8 * GIB, dockerMemory: 8 * GIB }, { EPGS_PREFLIGHT_MEMORY: '7680m' }),
        ).toMatchObject({ hostMemory: 7.5 * GIB, dockerMemory: 7.5 * GIB });
        expect(
            plan({ cpus: range(0, 3), hostMemory: 8 * GIB, dockerMemory: 8 * GIB }, { EPGS_PREFLIGHT_MEMORY: '64g' }),
        ).toMatchObject({ hostMemory: 8 * GIB, dockerMemory: 8 * GIB });
    });

    it('follows the CPU bands, the chain order and the parallel coverage cap given by the environment', () => {
        expect(
            plan(
                { cpus: range(0, 15), hostMemory: 32 * GIB, dockerMemory: 32 * GIB },
                { EPGS_PREFLIGHT_PARALLEL: '0' },
            ),
        ).toMatchObject({ parallel: false, cpusetA: '0-3', cpusetB: '0-15', cpusetBrowser: '0-15' });
        expect(
            plan(
                { cpus: range(0, 3), hostMemory: 8 * GIB, dockerMemory: 8 * GIB },
                { EPGS_PREFLIGHT_PARALLEL: '1', EPGS_PREFLIGHT_CPUSET_A: '0-1', EPGS_PREFLIGHT_CPUSET_B: '2-3' },
            ),
        ).toMatchObject({
            parallel: true,
            cpusetA: '0-1',
            cpusetB: '2-3',
            cpusetBrowser: '0-3',
            clientCoverageWorkers: 4,
            parallelClientCoverageWorkers: 2,
            playwrightWorkers: 4,
        });
        expect(
            plan(
                { cpus: range(0, 15), hostMemory: 32 * GIB, dockerMemory: 32 * GIB },
                { EPGS_PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS: '3' },
            ),
        ).toMatchObject({ parallelClientCoverageWorkers: 3 });
    });

    it('writes the decision as shell assignments and as the record line of summary.tsv', () => {
        const decided = plan({ cpus: range(0, 15), cores: smtCores, hostMemory: 18 * GIB, dockerMemory: 30 * GIB });

        expect(planShellAssignments(decided).split('\n')).toEqual([
            'PREFLIGHT_PARALLEL=1',
            'PREFLIGHT_CPUSET_A=0-3',
            'PREFLIGHT_CPUSET_B=4-7,12-15',
            'PREFLIGHT_CPUSET_BROWSER=0-15',
            `PREFLIGHT_CONTAINER_MEMORY=${16 * GIB}`,
            'PREFLIGHT_SERVER_WORKERS=16',
            'PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS=8',
            'PREFLIGHT_PARALLEL_CLIENT_COVERAGE_GATE_MAX_WORKERS=4',
            'PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS=8',
            `PREFLIGHT_RESOURCES_RECORD='${planRecord(decided)}'`,
        ]);
        expect(planRecord(decided)).toBe(
            `# resources cpus=0-15 host-memory=${18 * GIB} docker-memory=${30 * GIB} chains=parallel cpuset-a=0-3 ` +
                `cpuset-b=4-7,12-15 cpuset-b-browser=0-15 container-memory=${16 * GIB} server-workers=16 ` +
                'client-coverage-workers=8 parallel-client-coverage-workers=4 playwright-workers=8',
        );
    });

    it('reads the allowed CPUs, their physical cores, the smallest memory limit on the cgroup path and the Docker memory', () => {
        const files: Record<string, string> = {
            '/proc/self/status':
                'Name:\tnode\nCpus_allowed:\tffff\nCpus_allowed_list:\t0-3,8-11\nMems_allowed_list:\t0\n',
            '/proc/meminfo': 'MemTotal:       32000000 kB\nMemFree:        1000 kB\n',
            // cgroup v2 の行（`0` と空の controller と path を `:` でつなぐ）。
            '/proc/self/cgroup': `${['0', '', '/user.slice/work.slice/run.service'].join(':')}\n`,
            '/sys/fs/cgroup/user.slice/work.slice/run.service/memory.max': 'max\n',
            '/sys/fs/cgroup/user.slice/work.slice/memory.max': `${18 * GIB}\n`,
            '/sys/fs/cgroup/user.slice/memory.max': `${20 * GIB}\n`,
            // CPU 0 と 8、1 と 9 は同じ物理 core。CPU 2・3・10 は 1 core に 1 thread、CPU 11 は読めない。
            '/sys/devices/system/cpu/cpu0/topology/thread_siblings_list': '0,8\n',
            '/sys/devices/system/cpu/cpu8/topology/thread_siblings_list': '0,8\n',
            '/sys/devices/system/cpu/cpu1/topology/thread_siblings_list': '1,9\n',
            '/sys/devices/system/cpu/cpu9/topology/thread_siblings_list': '1,9\n',
            '/sys/devices/system/cpu/cpu2/topology/thread_siblings_list': '2\n',
            '/sys/devices/system/cpu/cpu3/topology/thread_siblings_list': '3\n',
            '/sys/devices/system/cpu/cpu10/topology/thread_siblings_list': '10\n',
        };
        const readText = (path: string): string | undefined => files[path];

        expect(detectResources({ readText, dockerMemory: () => 30 * GIB })).toEqual({
            cpus: [0, 1, 2, 3, 8, 9, 10, 11],
            cores: [[0, 8], [1, 9], [2], [3], [10], [11]],
            hostMemory: 18 * GIB,
            dockerMemory: 30 * GIB,
        });
        expect(
            detectResources({
                readText: path => (path.startsWith('/sys/') ? undefined : readText(path)),
                dockerMemory: () => 30 * GIB,
            }),
        ).toMatchObject({ cores: [[0], [1], [2], [3], [8], [9], [10], [11]], hostMemory: 32000000 * 1024 });
    });
});

describe('[AR-9.19] preflight refuses to start on a machine below the minimum or with unusable CPU bands', () => {
    const machine = { cpus: range(0, 15), hostMemory: 32 * GIB, dockerMemory: 32 * GIB };

    it('fails with fewer than 4 CPUs', () => {
        expect(failure({ cpus: range(0, 2), hostMemory: 32 * GIB, dockerMemory: 32 * GIB })).toEqual([
            '使える CPU が 3 個です。4 個以上が要ります',
        ]);
        expect(plan({ cpus: range(0, 3), hostMemory: 32 * GIB, dockerMemory: 32 * GIB }).cpusetA).toBe('0-3');
    });

    it('fails when host or Docker memory is below 7 GiB', () => {
        expect(failure({ cpus: range(0, 3), hostMemory: 7 * GIB - 1, dockerMemory: 32 * GIB })).toEqual([
            `host の memory が ${7 * GIB - 1} byte です。7 GiB 以上が要ります`,
        ]);
        expect(failure({ cpus: range(0, 3), hostMemory: 32 * GIB, dockerMemory: 7 * GIB - 1 })).toEqual([
            `Docker の memory が ${7 * GIB - 1} byte です。7 GiB 以上が要ります`,
        ]);
        expect(failure(machine, { EPGS_PREFLIGHT_MEMORY: '6g' })).toHaveLength(2);
        expect(plan({ cpus: range(0, 3), hostMemory: 7 * GIB, dockerMemory: 7 * GIB }).containerMemory).toBe(7 * GIB);
    });

    it('fails when a given CPU band reaches outside the allowed CPUs or is malformed', () => {
        expect(
            failure(
                { cpus: range(0, 7), hostMemory: 32 * GIB, dockerMemory: 32 * GIB },
                { EPGS_PREFLIGHT_CPUSET_B: '4-11' },
            ),
        ).toEqual(['EPGS_PREFLIGHT_CPUSET_B=4-11 に、使える CPU（0-7）の外の CPU があります']);
        expect(failure(machine, { EPGS_PREFLIGHT_CPUSET_A: 'zero' })).toEqual([
            'EPGS_PREFLIGHT_CPUSET_A=zero は CPU 帯の書式（例: 0-3,8）ではありません',
        ]);
        expect(failure(machine, { EPGS_PREFLIGHT_CPUSET_A: '3-1' })).toEqual([
            'EPGS_PREFLIGHT_CPUSET_A=3-1 は CPU 帯の書式（例: 0-3,8）ではありません',
        ]);
    });

    it('fails when the chains run at once on overlapping CPU bands', () => {
        expect(failure(machine, { EPGS_PREFLIGHT_CPUSET_A: '0-3', EPGS_PREFLIGHT_CPUSET_B: '2-9' })).toEqual([
            '2 系統を同時に流すのに、container A（0-3）と B（2-9）の CPU 帯が重なっています',
        ]);
        expect(
            plan(machine, {
                EPGS_PREFLIGHT_PARALLEL: '0',
                EPGS_PREFLIGHT_CPUSET_A: '0-3',
                EPGS_PREFLIGHT_CPUSET_B: '2-9',
            }),
        ).toMatchObject({ parallel: false, cpusetA: '0-3', cpusetB: '2-9' });
    });

    it('fails on malformed memory, chain and worker settings', () => {
        expect(failure(machine, { EPGS_PREFLIGHT_MEMORY: 'lots' })).toEqual([
            'EPGS_PREFLIGHT_MEMORY=lots は memory の量（例: 8g、7680m、byte 数）ではありません',
        ]);
        expect(failure(machine, { EPGS_PREFLIGHT_PARALLEL: 'yes' })).toEqual([
            'EPGS_PREFLIGHT_PARALLEL=yes は 0 か 1 ではありません',
        ]);
        expect(failure(machine, { EPGS_PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS: '0' })).toEqual([
            'EPGS_PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS=0 は 1 以上の整数ではありません',
        ]);
    });
});

describe('[AR-9.20] preflight checks the tools of the selected steps before starting any', () => {
    const probe = (state: { docker?: 'ok' | 'missing' | 'rootless'; python3Yaml?: boolean; mise?: boolean }) => {
        const asked: string[] = [];
        return {
            asked,
            probe: {
                docker: () => (asked.push('docker'), state.docker ?? 'ok'),
                python3Yaml: () => (asked.push('python3Yaml'), state.python3Yaml ?? true),
                mise: () => (asked.push('mise'), state.mise ?? true),
            },
        };
    };

    it('reports nothing when every tool of the selected steps is present', () => {
        const { asked, probe: tools } = probe({});
        expect(missingTools(['stale-containers', 'rehearsal-setup', 'node-matrix'], tools)).toEqual([]);
        expect(asked).toEqual(['docker', 'python3Yaml', 'mise']);
    });

    it('checks only the tools the selected steps use', () => {
        const { asked, probe: tools } = probe({ python3Yaml: false, mise: false });
        expect(missingTools(['deps-prepare', 'server-check'], tools)).toEqual([]);
        expect(asked).toEqual(['docker']);
    });

    it('names each missing tool and the step that needs it', () => {
        expect(
            missingTools(['rehearsal-setup', 'node-matrix'], probe({ python3Yaml: false, mise: false }).probe),
        ).toEqual([
            'python3 と PyYAML が使えません（rehearsal-setup が workflow の file を読むのに使います）',
            'mise が使えません（node-matrix が Node 24 と 26 を使うのに使います）',
        ]);
        expect(missingTools(['client'], probe({ docker: 'missing' }).probe)).toEqual([
            'Docker の daemon へ接続できません（すべての step が使います）',
        ]);
        expect(missingTools(['client'], probe({ docker: 'rootless' }).probe)).toEqual([
            'Docker が rootless です。模擬 container は rootful の Docker を要ります',
        ]);
    });
});
