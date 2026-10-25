#!/usr/bin/env node
// preflight の構成を、実行する環境の CPU と memory から決める（.kiro/specs/server-application-runtime/design.md §12.3.4）。
//   node scripts/preflight-resources.mjs --steps <step>[,<step>...]
// 選んだ step が使う道具を確かめ、使える CPU と memory を求め、模擬 container の CPU 帯と memory の上限、2 系統を
// 同時に流すかどうか、test の worker 数を決めて、release-preflight.sh が eval する代入の行を stdout へ出す。
// 道具が足りない、最低限に届かない、指定が使えないときは、理由を stderr へ出して 1 で終わる。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GIB = 1024 ** 3;
// hosted runner の CPU 数。container A はこの数の CPU で hosted runner を模す。
const MIN_CPUS = 4;
// 8 GB の機械が報告する量。
const MIN_MEMORY = 7 * GIB;
const PARALLEL_MIN_CPUS = 8;
const PARALLEL_MIN_DOCKER_MEMORY = 24 * GIB;
const CONTAINER_A_CPUS = 4;
const CONTAINER_B_MAX_CPUS = 8;
const CONTAINER_MEMORY_LIMIT = 16 * GIB;
// worker 数の memory からの上限は (memory − MEMORY_RESERVE) ÷ 1 worker の量。
const MEMORY_RESERVE = 1 * GIB;
const SERVER_WORKER_MEMORY = 2 * GIB;
const CLIENT_COVERAGE_WORKER_MEMORY = 1.5 * GIB;
const PLAYWRIGHT_WORKER_MEMORY = 1 * GIB;
// docker-gate-node24 と client の系統を同時に流すときの上限。docker-gate-node24 は image の build で disk I/O と memory 帯域を
// 使い、その競合は CPU 帯の分離では避けられない。同時に流すと、coverage:gate の既定（8 workers）では
// upload-submit.spec.test.tsx の重い test が 5000ms の timeout を超え、Playwright の既定（6 workers）では e2e の 2 test が
// locator と click の timeout で落ちた。この値では落ちない。
const PARALLEL_CLIENT_COVERAGE_WORKERS = 4;
const PARALLEL_PLAYWRIGHT_WORKERS = 2;

const CPU_LIST = /^\d+(-\d+)?(,\d+(-\d+)?)*$/;

/** `0-3,8` の形を CPU 番号の昇順の配列にする。書式が誤っていれば undefined。 */
const parseCpuList = text => {
    if (!CPU_LIST.test(text)) return undefined;
    const cpus = new Set();
    for (const part of text.split(',')) {
        const [first, last = first] = part.split('-').map(Number);
        if (last < first) return undefined;
        for (let cpu = first; cpu <= last; cpu++) cpus.add(cpu);
    }
    return [...cpus].sort((a, b) => a - b);
};

/** CPU 番号の配列を、連続する番号をまとめた `2-3,5-14` の形にする。 */
const formatCpuList = cpus => {
    const sorted = [...cpus].sort((a, b) => a - b);
    const runs = [];
    let start = sorted[0];
    for (let index = 1; index <= sorted.length; index++) {
        if (index < sorted.length && sorted[index] === sorted[index - 1] + 1) continue;
        const end = sorted[index - 1];
        runs.push(start === end ? `${start}` : `${start}-${end}`);
        start = sorted[index];
    }
    return runs.join(',');
};

const MEMORY_UNITS = { '': 1, k: 1024, m: 1024 ** 2, g: GIB };

/** `8g`・`7680m`・byte 数を byte 数にする。書式が誤っていれば undefined。 */
const parseMemory = text => {
    const match = /^(\d+)([kmg]?)$/i.exec(text);
    if (match === null) return undefined;
    const bytes = Number(match[1]) * MEMORY_UNITS[match[2].toLowerCase()];
    return bytes > 0 ? bytes : undefined;
};

const workersByMemory = (memory, perWorker) => Math.max(1, Math.floor((memory - MEMORY_RESERVE) / perWorker));

const setting = (env, name) => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
};

/**
 * 構成を決める。machine は { cpus: 使える CPU 番号, hostMemory, dockerMemory }（byte）。
 * 成功なら { ok: true, plan }、失敗なら { ok: false, errors }（理由の文）。
 */
export const planPreflightResources = (machine, env) => {
    const errors = [];
    const cpus = [...new Set(machine.cpus)].sort((a, b) => a - b);
    let { hostMemory, dockerMemory } = machine;

    const memorySetting = setting(env, 'EPGS_PREFLIGHT_MEMORY');
    if (memorySetting !== undefined) {
        const limit = parseMemory(memorySetting);
        if (limit === undefined) {
            errors.push(`EPGS_PREFLIGHT_MEMORY=${memorySetting} は memory の量（例: 8g、7680m、byte 数）ではありません`);
        } else {
            hostMemory = Math.min(hostMemory, limit);
            dockerMemory = Math.min(dockerMemory, limit);
        }
    }
    if (cpus.length < MIN_CPUS) errors.push(`使える CPU が ${cpus.length} 個です。${MIN_CPUS} 個以上が要ります`);
    if (hostMemory < MIN_MEMORY) errors.push(`host の memory が ${hostMemory} byte です。7 GiB 以上が要ります`);
    if (dockerMemory < MIN_MEMORY) errors.push(`Docker の memory が ${dockerMemory} byte です。7 GiB 以上が要ります`);

    let parallel = cpus.length >= PARALLEL_MIN_CPUS && dockerMemory >= PARALLEL_MIN_DOCKER_MEMORY;
    const parallelSetting = setting(env, 'EPGS_PREFLIGHT_PARALLEL');
    if (parallelSetting !== undefined) {
        if (parallelSetting === '0' || parallelSetting === '1') parallel = parallelSetting === '1';
        else errors.push(`EPGS_PREFLIGHT_PARALLEL=${parallelSetting} は 0 か 1 ではありません`);
    }

    const cpuset = (name, fallback) => {
        const given = setting(env, name);
        if (given === undefined) return fallback;
        const parsed = parseCpuList(given);
        if (parsed === undefined) {
            errors.push(`${name}=${given} は CPU 帯の書式（例: 0-3,8）ではありません`);
            return undefined;
        }
        if (parsed.some(cpu => !cpus.includes(cpu))) {
            errors.push(`${name}=${given} に、使える CPU（${formatCpuList(cpus)}）の外の CPU があります`);
            return undefined;
        }
        return parsed;
    };
    const cpusA = cpuset('EPGS_PREFLIGHT_CPUSET_A', cpus.slice(0, CONTAINER_A_CPUS));
    const cpusB = cpuset(
        'EPGS_PREFLIGHT_CPUSET_B',
        parallel
            ? cpus.slice(CONTAINER_A_CPUS, CONTAINER_A_CPUS + CONTAINER_B_MAX_CPUS)
            : cpus.slice(0, CONTAINER_B_MAX_CPUS),
    );
    if (parallel && cpusA !== undefined && cpusB !== undefined && cpusA.some(cpu => cpusB.includes(cpu))) {
        errors.push(
            `2 系統を同時に流すのに、container A（${formatCpuList(cpusA)}）と B（${formatCpuList(cpusB)}）の CPU 帯が重なっています`,
        );
    }

    const workerSetting = (name, fallback) => {
        const given = setting(env, name);
        if (given === undefined) return fallback;
        if (!/^[1-9]\d*$/.test(given)) {
            errors.push(`${name}=${given} は 1 以上の整数ではありません`);
            return fallback;
        }
        return Number(given);
    };
    const parallelCoverageCap = workerSetting('EPGS_PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS', PARALLEL_CLIENT_COVERAGE_WORKERS);
    const parallelPlaywrightCap = workerSetting('EPGS_PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS', PARALLEL_PLAYWRIGHT_WORKERS);

    if (errors.length > 0) return { ok: false, errors };

    const containerMemory = Math.min(CONTAINER_MEMORY_LIMIT, dockerMemory);
    const clientCoverageWorkers = Math.min(
        cpusB.length,
        8,
        workersByMemory(containerMemory, CLIENT_COVERAGE_WORKER_MEMORY),
    );
    // client/playwright.config.ts が CI で CPU 数から選ぶ数（CPU 数 − 2 を 4〜6 に収めた数）。
    const playwrightByCpu = Math.min(6, Math.max(4, cpusB.length - 2));
    const playwrightWorkers = Math.min(playwrightByCpu, workersByMemory(containerMemory, PLAYWRIGHT_WORKER_MEMORY));
    return {
        ok: true,
        plan: {
            cpus: formatCpuList(cpus),
            hostMemory,
            dockerMemory,
            parallel,
            cpusetA: formatCpuList(cpusA),
            cpusetB: formatCpuList(cpusB),
            containerMemory,
            serverWorkers: Math.min(cpus.length, workersByMemory(hostMemory, SERVER_WORKER_MEMORY)),
            clientCoverageWorkers,
            playwrightWorkers,
            parallelClientCoverageWorkers: Math.min(parallelCoverageCap, clientCoverageWorkers),
            parallelPlaywrightWorkers: Math.min(parallelPlaywrightCap, playwrightWorkers),
        },
    };
};

/** summary.tsv の 2 行目に書く構成の記録。 */
export const planRecord = plan =>
    [
        '# resources',
        `cpus=${plan.cpus}`,
        `host-memory=${plan.hostMemory}`,
        `docker-memory=${plan.dockerMemory}`,
        `chains=${plan.parallel ? 'parallel' : 'serial'}`,
        `cpuset-a=${plan.cpusetA}`,
        `cpuset-b=${plan.cpusetB}`,
        `container-memory=${plan.containerMemory}`,
        `server-workers=${plan.serverWorkers}`,
        `client-coverage-workers=${plan.clientCoverageWorkers}`,
        `playwright-workers=${plan.playwrightWorkers}`,
        `parallel-client-coverage-workers=${plan.parallelClientCoverageWorkers}`,
        `parallel-playwright-workers=${plan.parallelPlaywrightWorkers}`,
    ].join(' ');

/** release-preflight.sh が eval する代入の行。値は数字・CPU 帯・記録の文だけで、shell の特殊文字を含まない。 */
export const planShellAssignments = plan =>
    [
        `PREFLIGHT_PARALLEL=${plan.parallel ? 1 : 0}`,
        `PREFLIGHT_CPUSET_A=${plan.cpusetA}`,
        `PREFLIGHT_CPUSET_B=${plan.cpusetB}`,
        `PREFLIGHT_CONTAINER_MEMORY=${plan.containerMemory}`,
        `PREFLIGHT_SERVER_WORKERS=${plan.serverWorkers}`,
        `PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS=${plan.clientCoverageWorkers}`,
        `PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS=${plan.playwrightWorkers}`,
        `PREFLIGHT_PARALLEL_CLIENT_COVERAGE_GATE_MAX_WORKERS=${plan.parallelClientCoverageWorkers}`,
        `PREFLIGHT_PARALLEL_CLIENT_PLAYWRIGHT_WORKERS=${plan.parallelPlaywrightWorkers}`,
        `PREFLIGHT_RESOURCES_RECORD='${planRecord(plan)}'`,
    ].join('\n');

const TOOLS = [
    {
        name: 'docker',
        steps: undefined,
        message: state =>
            state === 'rootless'
                ? 'Docker が rootless です。模擬 container は rootful の Docker を要ります'
                : 'Docker の daemon へ接続できません（すべての step が使います）',
        missing: state => state !== 'ok',
    },
    {
        name: 'python3Yaml',
        steps: ['rehearsal-setup'],
        message: () => 'python3 と PyYAML が使えません（rehearsal-setup が workflow の file を読むのに使います）',
        missing: state => state !== true,
    },
    {
        name: 'mise',
        steps: ['node-matrix'],
        message: () => 'mise が使えません（node-matrix が Node 24 と 26 を使うのに使います）',
        missing: state => state !== true,
    },
];

/**
 * 選んだ step が使う道具のうち、足りないものの説明を返す。probe は道具ごとの確かめ方
 * （docker: 'ok' | 'missing' | 'rootless'、python3Yaml と mise: boolean）。
 */
export const missingTools = (steps, probe) => {
    const missing = [];
    for (const tool of TOOLS) {
        if (tool.steps !== undefined && !tool.steps.some(step => steps.includes(step))) continue;
        const state = probe[tool.name]();
        if (tool.missing(state)) missing.push(tool.message(state));
    }
    return missing;
};

/** cgroup v2 の自分の path とその祖先、または cgroup v1 の memory controller の上限のうち最小。無ければ undefined。 */
const cgroupMemoryLimit = readText => {
    const cgroup = readText('/proc/self/cgroup');
    if (cgroup === undefined) return undefined;
    const limits = [];
    for (const line of cgroup.trim().split('\n')) {
        const [, controllers, path] = line.split(':');
        const [root, file] =
            controllers === ''
                ? ['/sys/fs/cgroup', 'memory.max']
                : controllers.split(',').includes('memory')
                  ? ['/sys/fs/cgroup/memory', 'memory.limit_in_bytes']
                  : [undefined, undefined];
        if (root === undefined) continue;
        for (let current = path; ; current = current.slice(0, current.lastIndexOf('/'))) {
            const value = readText(`${root}${current === '/' ? '' : current}/${file}`)?.trim();
            if (value !== undefined && /^\d+$/.test(value)) limits.push(Number(value));
            if (current === '' || current === '/') break;
        }
    }
    return limits.length === 0 ? undefined : Math.min(...limits);
};

/**
 * 使える CPU と memory を求める。readText は file の中身（無ければ undefined）、dockerMemory は Docker の MemTotal を返す。
 */
export const detectResources = ({ readText, dockerMemory }) => {
    const status = readText('/proc/self/status') ?? '';
    const allowed = /^Cpus_allowed_list:\s*(\S+)$/m.exec(status)?.[1];
    const cpus = allowed === undefined ? [] : (parseCpuList(allowed) ?? []);
    const memTotal = /^MemTotal:\s*(\d+) kB$/m.exec(readText('/proc/meminfo') ?? '')?.[1];
    const total = memTotal === undefined ? 0 : Number(memTotal) * 1024;
    const limit = cgroupMemoryLimit(readText);
    return {
        cpus,
        hostMemory: limit === undefined ? total : Math.min(total, limit),
        dockerMemory: dockerMemory(),
    };
};

const succeeds = (command, args) => {
    try {
        return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
        return undefined;
    }
};

const realProbe = {
    docker: () => {
        const options = succeeds('docker', ['info', '--format', '{{json .SecurityOptions}}']);
        if (options === undefined) return 'missing';
        return options.includes('rootless') ? 'rootless' : 'ok';
    },
    python3Yaml: () => succeeds('python3', ['-c', 'import yaml']) !== undefined,
    mise: () => succeeds('mise', ['--version']) !== undefined,
};

const readTextOrUndefined = path => {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return undefined;
    }
};

const main = argv => {
    const index = argv.indexOf('--steps');
    const steps = index === -1 ? [] : (argv[index + 1] ?? '').split(',').filter(step => step !== '');
    const fail = errors => {
        for (const error of errors) process.stderr.write(`release-preflight: ${error}\n`);
        process.exit(1);
    };
    const missing = missingTools(steps, realProbe);
    if (missing.length > 0) fail(missing);
    const machine = detectResources({
        readText: readTextOrUndefined,
        dockerMemory: () => {
            const value = Number(succeeds('docker', ['info', '--format', '{{.MemTotal}}'])?.trim());
            return Number.isFinite(value) ? value : 0;
        },
    });
    const result = planPreflightResources(machine, process.env);
    if (!result.ok) fail(result.errors);
    process.stdout.write(`${planShellAssignments(result.plan)}\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
