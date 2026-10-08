/**
 * 公開用 Docker image の手元の確認の、準備済みの確認と image の構築。
 *
 * 外部へは取りに行かない。必要な base image と npm の層は `prepare-dependency-images.mjs` が
 * 先に手元へ揃えておく。ここは `docker image inspect` で在ることを確かめ（無ければ
 * `not-prepared`）、製品の Dockerfile の依存の部分だけを準備済みの npm の層に置き換えた
 * Dockerfile を導いて、`--network=none --pull=false` で構築する。
 *
 * `run(argv, { timeoutMs })` は `{ code, stdout, stderr }` を返す（時間切れは `code: null`）。
 * `createDockerLedger(run)` が包んだ `run` は、呼んだ docker の argv を順に記録する。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FETCH_TIMEOUT_MS, planDependencyImages } from './dependency-images.mjs';

/** 準備の step の command。`not-prepared` の message に示す。 */
export const PREPARE_COMMAND = 'node scripts/server-test/prepare-dependency-images.mjs';

/**
 * 構築の上限時間は、hang を止めるための上限で、所要時間の基準ではない。準備の build と同じ上限
 * （`FETCH_TIMEOUT_MS.osBuild`）を使う。inspect の上限時間も別に持つ。
 */
export const BUILD_TIMEOUT_MS = FETCH_TIMEOUT_MS.osBuild;
export const INSPECT_TIMEOUT_MS = 60_000;

/**
 * 応答の確認の deadline も、hang を止めるための上限で、所要時間の基準ではない。1 回の試行
 * （`docker exec`）の上限が `INSPECT_TIMEOUT_MS` なので、deadline はそれと同じ値にする。
 */
export const PROBE_DEADLINE_MS = INSPECT_TIMEOUT_MS;

/**
 * integration test 1 case の上限。構築の上限、応答の deadline、それ以外の docker の呼び出し
 * 1 回分の上限の和。
 */
export const IMAGE_CHECK_TEST_TIMEOUT_MS = BUILD_TIMEOUT_MS + PROBE_DEADLINE_MS + INSPECT_TIMEOUT_MS;

const IMAGE_ID = /^(?:sha256:)?[0-9a-f]{64}$/u;
const CHECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const FLAVORS = Object.freeze(['debian', 'alpine']);

/** 確認の失敗。`reason` は `not-prepared`・`build-failed` など。 */
export class DockerImageCheckError extends Error {
    constructor(reason, message) {
        super(`${reason}: ${message}`);
        this.name = 'DockerImageCheckError';
        this.reason = reason;
    }
}

function tail(text) {
    const trimmed = String(text ?? '').trim();
    return trimmed.length > 800 ? `...${trimmed.slice(-800)}` : trimmed;
}

function assertFlavor(flavor) {
    if (!FLAVORS.includes(flavor)) {
        throw new Error(`unknown flavor: ${flavor}`);
    }
}

function assertId(id) {
    if (!CHECK_ID.test(id)) {
        throw new Error(`invalid check id: ${id}`);
    }
}

/** 呼んだ docker の argv を記録する `run`。`ledger` は呼び出し順の argv の配列。 */
export function createDockerLedger(run) {
    const ledger = [];
    return {
        ledger,
        run: (argv, options) => {
            ledger.push([...argv]);
            return run(argv, options);
        },
    };
}

async function isPresent(run, ref) {
    const inspected = await run(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref], {
        timeoutMs: INSPECT_TIMEOUT_MS,
    });
    return inspected.code === 0 && IMAGE_ID.test(String(inspected.stdout).trim());
}

/**
 * base（Dockerfile の digest で固定した ref）と、`flavor` の npm の層（現在の tag）が手元に
 * あることを `docker image inspect` だけで確かめる。無ければ `not-prepared` で失敗し、取得は
 * しない。成功したら、`flavor` の npm の層の tag を `{ client, server }` で返す。
 */
export async function verifyPrepared({ root, run, flavor }) {
    assertFlavor(flavor);
    const plan = planDependencyImages(root);
    const npmLayers = plan.images.filter(image => image.layer === 'npm' && image.kind.startsWith(`${flavor}-`));
    const required = [...plan.bases.map(base => base.ref), ...npmLayers.map(image => image.tag)];
    const missing = [];
    for (const ref of required) {
        if (!(await isPresent(run, ref))) {
            missing.push(ref);
        }
    }
    if (missing.length > 0) {
        throw new DockerImageCheckError(
            'not-prepared',
            `${missing.join(', ')} not in the local image store; run \`${PREPARE_COMMAND}\` first`,
        );
    }
    return {
        client: npmLayers.find(image => image.kind === `${flavor}-client`).tag,
        server: npmLayers.find(image => image.kind === `${flavor}-server`).tag,
    };
}

/**
 * 製品の Dockerfile の各 builder stage の依存の部分（`FROM` から最初の `COPY . ` の直前まで）を
 * `FROM <npm の層の tag> AS <stage>` の 1 行に置き換えた Dockerfile の文字列を返す。それ以外の行
 * は製品のまま。
 */
export function deriveImageDockerfile({ root, flavor, plan = planDependencyImages(root) }) {
    assertFlavor(flavor);
    const lines = readFileSync(join(root, `Dockerfile.${flavor}`), 'utf8').split(/\r?\n/u);
    const stages = plan.stages.filter(stage => stage.flavor === flavor).sort((a, b) => b.from - a.from);
    for (const stage of stages) {
        lines.splice(stage.from, stage.copy - stage.from, `FROM ${stage.npmTag} AS ${stage.stage}`);
    }
    return lines.join('\n');
}

/** 導いた Dockerfile を `test/server/.artifacts/docker-image-check/<id>/Dockerfile` に書く。 */
export function writeImageDockerfile({ root, flavor, id, plan }) {
    assertId(id);
    const directory = join(root, 'test', 'server', '.artifacts', 'docker-image-check', id);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'Dockerfile');
    writeFileSync(path, deriveImageDockerfile({ root, flavor, plan }));
    return path;
}

/** 検査用 image の名前（`epgstation-docker-check-<flavor>:<id>`）。 */
export function checkImageName(flavor, id) {
    assertFlavor(flavor);
    assertId(id);
    return `epgstation-docker-check-${flavor}:${id}`;
}

/**
 * 導いた Dockerfile で image を構築し、`Os=linux`・`Architecture=amd64` を確かめる。context は
 * repository root（`.dockerignore` が効く）。構築の失敗・platform の不一致は `build-failed`。
 * 構築した image の名前を返す。
 */
export async function buildCheckImage({ root, run, flavor, id, dockerfilePath }) {
    const image = checkImageName(flavor, id);
    const built = await run(
        [
            'docker',
            'build',
            '--platform',
            'linux/amd64',
            '--network=none',
            '--pull=false',
            '--no-cache',
            '-f',
            dockerfilePath,
            '-t',
            image,
            '--label',
            `epgstation.docker-check.owner=${id}`,
            root,
        ],
        { timeoutMs: BUILD_TIMEOUT_MS },
    );
    if (built.code !== 0) {
        const how = built.code === null ? 'timed out' : `exit ${built.code}`;
        throw new DockerImageCheckError('build-failed', `${image} ${how}: ${tail(built.stderr)}`);
    }
    const inspected = await run(['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', image], {
        timeoutMs: INSPECT_TIMEOUT_MS,
    });
    const platform = String(inspected.stdout).trim();
    if (inspected.code !== 0 || platform !== 'linux/amd64') {
        throw new DockerImageCheckError(
            'build-failed',
            `${image} is ${inspected.code === 0 ? platform : 'not inspectable'}, expected linux/amd64`,
        );
    }
    return image;
}

/** 実際に docker を呼ぶ `run`。時間切れは `code: null`、起動できなければ `code: 127`。 */
export function spawnRun(argv, { timeoutMs }) {
    return new Promise(resolve => {
        const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout.on('data', chunk => {
            stdout += String(chunk);
        });
        child.stderr.on('data', chunk => {
            stderr += String(chunk);
        });
        child.on('error', error => {
            clearTimeout(timer);
            resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
        });
        child.on('close', code => {
            clearTimeout(timer);
            resolve({ code: timedOut ? null : code, stdout, stderr });
        });
    });
}

/** この run が作る資源の label。container・network・image のすべてに付け、片付けはこれで探す。 */
export const OWNER_LABEL = 'epgstation.docker-check.owner';

/** tuner server の代役が待ち受ける port。 */
export const STUB_PORT = 40772;

/**
 * tuner server の代役。`/api/version`・`/api/status` だけに決まった body で応じ、それ以外は `[]`。
 * 検査対象の image を `--entrypoint node` で起動して動かす。外へは接続しない。
 */
export const TUNER_STUB_SCRIPT = `const http = require('http');
http
    .createServer((request, response) => {
        const path = request.url.split('?')[0];
        let body = '[]';
        if (path === '/api/version') {
            body = JSON.stringify({ current: '0.0.0-stub', latest: '0.0.0-stub' });
        } else if (path === '/api/status') {
            body = '{}';
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(body);
    })
    .listen(${STUB_PORT}, '0.0.0.0');
`;

/** この run の資源の名前。 */
export function checkResourceNames(flavor, id) {
    assertFlavor(flavor);
    assertId(id);
    return {
        network: `epgs-docker-check-${id}`,
        stub: `epgs-docker-check-${flavor}-stub-${id}`,
        server: `epgs-docker-check-${flavor}-${id}`,
        image: checkImageName(flavor, id),
    };
}

const LOG_CONFIGS = Object.freeze(['serviceLogConfig', 'operatorLogConfig', 'epgUpdaterLogConfig']);

/**
 * 代役と設定を `test/server/.artifacts/docker-image-check/<id>/` に書く。設定は
 * `config/config.yml.template` の複製の `mirakurunPath` を代役の container 名にしたものと、
 * `config/*LogConfig.sample.yml` の複製（`*LogConfig.yml`）。書いた path と `mirakurunPath` を返す。
 */
export function writeStubAndConfig({ root, flavor, id }) {
    const names = checkResourceNames(flavor, id);
    const directory = join(root, 'test', 'server', '.artifacts', 'docker-image-check', id);
    const configDirectory = join(directory, 'config');
    mkdirSync(configDirectory, { recursive: true });
    const mirakurunPath = `http://${names.stub}:${STUB_PORT}/`;
    const template = readFileSync(join(root, 'config', 'config.yml.template'), 'utf8');
    const replaced = template.replace(/^mirakurunPath:.*$/mu, `mirakurunPath: ${mirakurunPath}`);
    if (replaced === template) {
        throw new Error('config.yml.template has no mirakurunPath line');
    }
    const configs = { 'config.yml': join(configDirectory, 'config.yml') };
    writeFileSync(configs['config.yml'], replaced);
    for (const name of LOG_CONFIGS) {
        const file = join(configDirectory, `${name}.yml`);
        writeFileSync(file, readFileSync(join(root, 'config', `${name}.sample.yml`), 'utf8'));
        configs[`${name}.yml`] = file;
    }
    const stubPath = join(directory, 'stub.js');
    writeFileSync(stubPath, TUNER_STUB_SCRIPT);
    return { stubPath, configs, mirakurunPath };
}

async function dockerOk(run, argv, what) {
    const result = await run(argv, { timeoutMs: INSPECT_TIMEOUT_MS });
    if (result.code !== 0) {
        const how = result.code === null ? 'timed out' : `exit ${result.code}`;
        throw new DockerImageCheckError('start-failed', `${what} ${how}: ${tail(result.stderr)}`);
    }
    return String(result.stdout).trim();
}

async function logsOf(run, name) {
    const logs = await run(['docker', 'logs', '--tail', '40', name], { timeoutMs: INSPECT_TIMEOUT_MS });
    return `[${name}] ${tail(`${logs.stdout}${logs.stderr}`) || '(no output)'}`;
}

/** 失敗の message に付ける、server・stub の `docker logs --tail`。 */
async function failureLogs(run, names) {
    return `\n${await logsOf(run, names.server)}\n${await logsOf(run, names.stub)}`;
}

async function isRunning(run, name) {
    const state = await run(['docker', 'inspect', '--format', '{{.State.Running}}', name], {
        timeoutMs: INSPECT_TIMEOUT_MS,
    });
    return state.code === 0 && String(state.stdout).trim() === 'true';
}

/** server container の中から `GET <path>` を実行し、`{ status, contentType, body }` を返す（接続できなければ undefined）。 */
async function fetchInside(run, server, path) {
    const script = `fetch('http://127.0.0.1:8888${path}').then(async r => console.log(JSON.stringify({status: r.status, contentType: r.headers.get('content-type') ?? '', body: (await r.text()).slice(0, 4096)}))).catch(() => process.exit(3))`;
    const result = await run(['docker', 'exec', server, 'node', '-e', script], { timeoutMs: INSPECT_TIMEOUT_MS });
    if (result.code !== 0) {
        return undefined;
    }
    try {
        return JSON.parse(String(result.stdout).trim());
    } catch {
        return undefined;
    }
}

/**
 * 代役と server を起動する。専用の network に置き、host の port は公開しない。
 * 返すのは起動した資源の名前と、生成した設定の `mirakurunPath`。
 */
export async function startServer({ root, run, flavor, id }) {
    const names = checkResourceNames(flavor, id);
    const { stubPath, configs, mirakurunPath } = writeStubAndConfig({ root, flavor, id });
    const label = `${OWNER_LABEL}=${id}`;
    await dockerOk(run, ['docker', 'network', 'create', '--label', label, names.network], 'network create');
    await dockerOk(
        run,
        [
            'docker',
            'run',
            '-d',
            '--name',
            names.stub,
            '--network',
            names.network,
            '--label',
            label,
            '-v',
            `${stubPath}:/stub.js:ro`,
            '--entrypoint',
            'node',
            names.image,
            '/stub.js',
        ],
        'stub start',
    );
    const mounts = Object.entries(configs).flatMap(([name, file]) => ['-v', `${file}:/app/config/${name}:ro`]);
    await dockerOk(
        run,
        [
            'docker',
            'run',
            '-d',
            '--name',
            names.server,
            '--network',
            names.network,
            '--label',
            label,
            ...mounts,
            names.image,
        ],
        'server start',
    );
    return { names, mirakurunPath };
}

/**
 * server container の中から、deadline まで 1 秒間隔で `GET /api/version` を試す。container が
 * 終了していれば即座に `start-failed`。通ったら、`/api/version` が 200 で `version` が
 * `expectedVersion` と一致し、`GET /` が 200 の HTML であることを確かめる（満たさなければ
 * `response-invalid`）。失敗の message には server・stub の `docker logs --tail` を含める。
 * 応答までにかかった時間（ms）を返す。
 */
export async function probeHttp({
    run,
    names,
    expectedVersion,
    deadlineMs,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = Date.now,
}) {
    const started = now();
    let version;
    for (;;) {
        if (!(await isRunning(run, names.server))) {
            throw new DockerImageCheckError(
                'start-failed',
                `${names.server} is not running${await failureLogs(run, names)}`,
            );
        }
        version = await fetchInside(run, names.server, '/api/version');
        if (version !== undefined) {
            break;
        }
        if (now() - started >= deadlineMs) {
            throw new DockerImageCheckError(
                'start-failed',
                `${names.server} did not answer GET /api/version within ${deadlineMs} ms${await failureLogs(run, names)}`,
            );
        }
        await sleep(1000);
    }
    const elapsedMs = now() - started;
    let reported;
    try {
        reported = JSON.parse(version.body).version;
    } catch {
        reported = undefined;
    }
    if (version.status !== 200 || reported !== expectedVersion) {
        throw new DockerImageCheckError(
            'response-invalid',
            `GET /api/version returned ${version.status} version=${String(reported)}, expected 200 version=${expectedVersion}${await failureLogs(run, names)}`,
        );
    }
    const index = await fetchInside(run, names.server, '/');
    if (index === undefined || index.status !== 200 || !/^text\/html/iu.test(index.contentType)) {
        throw new DockerImageCheckError(
            'response-invalid',
            `GET / returned ${index === undefined ? 'no response' : `${index.status} ${index.contentType}`}, expected 200 text/html${await failureLogs(run, names)}`,
        );
    }
    return elapsedMs;
}

/** 起動した server container の構成（network の名前と、host へ公開した port の束縛）。 */
export async function inspectServerShape(run, names) {
    const inspected = await dockerOk(
        run,
        ['docker', 'inspect', '--format', '{{json .}}', names.server],
        'server inspect',
    );
    const container = JSON.parse(inspected);
    return {
        networks: Object.keys(container.NetworkSettings?.Networks ?? {}),
        publishedPorts: Object.values(container.HostConfig?.PortBindings ?? {}).flat(),
    };
}

/** label の付いた資源を列挙する argv（container・network・image の順）。 */
function listArgv(id) {
    const filter = `label=${OWNER_LABEL}=${id}`;
    return {
        containers: ['docker', 'ps', '-a', '-q', '--no-trunc', '--filter', filter],
        networks: ['docker', 'network', 'ls', '-q', '--no-trunc', '--filter', filter],
        images: ['docker', 'images', '-q', '--no-trunc', '--filter', filter],
    };
}

async function listIds(run, argv) {
    const listed = await run(argv, { timeoutMs: INSPECT_TIMEOUT_MS });
    return listed.code === 0 ? [...new Set(String(listed.stdout).split(/\s+/u).filter(Boolean))] : undefined;
}

/**
 * この run の container・network・検査用 image（label で探す）を削除し、残っていないことを
 * 列挙し直して確かめる。依存 image・base には触れない。残っていれば `cleanup-failed`。
 */
export async function cleanupResources({ run, id }) {
    assertId(id);
    const list = listArgv(id);
    for (const container of (await listIds(run, list.containers)) ?? []) {
        await run(['docker', 'rm', '-f', container], { timeoutMs: INSPECT_TIMEOUT_MS });
    }
    for (const network of (await listIds(run, list.networks)) ?? []) {
        await run(['docker', 'network', 'rm', network], { timeoutMs: INSPECT_TIMEOUT_MS });
    }
    for (const image of (await listIds(run, list.images)) ?? []) {
        await run(['docker', 'rmi', '-f', image], { timeoutMs: INSPECT_TIMEOUT_MS });
    }
    const left = [];
    for (const [kind, argv] of Object.entries(list)) {
        const ids = await listIds(run, argv);
        if (ids === undefined) {
            left.push(`${kind}: not listable`);
        } else if (ids.length > 0) {
            left.push(`${kind}: ${ids.join(',')}`);
        }
    }
    if (left.length > 0) {
        throw new DockerImageCheckError('cleanup-failed', `left behind (${OWNER_LABEL}=${id}) ${left.join('; ')}`);
    }
}

/**
 * 呼んだ docker の argv に registry への公開（`push`・`login`・`--push`・registry への
 * `--output`）が無いことを確かめる。あれば `registry-access`。
 */
export function assertNoRegistryAccess(ledger) {
    for (const argv of ledger) {
        const outputs = argv.flatMap((token, index) => {
            if (token === '--output' || token === '-o') {
                return [String(argv[index + 1] ?? '')];
            }
            return token.startsWith('--output=') ? [token.slice('--output='.length)] : [];
        });
        const registryOutput = outputs.some(value => /(?:^|,)(?:type=registry|push=true)(?:,|$)/u.test(value));
        if (argv.some(token => token === 'push' || token === 'login' || token === '--push') || registryOutput) {
            throw new DockerImageCheckError('registry-access', `docker ${argv.join(' ')}`);
        }
    }
}

/**
 * 準備済みの確認から片付けまでの 1 回の流れ。成功・失敗のどちらでも、この run の container・
 * network・検査用 image を片付ける。返すのは確認した事実。失敗は `DockerImageCheckError`（`reason`
 * は `not-prepared`・`build-failed`・`start-failed`・`response-invalid`・`cleanup-failed`）。
 * 片付けも失敗したときは `cleanup-failed` に、先に起きた失敗の message を添える。
 */
export async function runImageCheck({ root, run, flavor, id, probeDeadlineMs, sleep, now }) {
    let primary;
    let facts;
    try {
        await verifyPrepared({ root, run, flavor });
        const dockerfilePath = writeImageDockerfile({ root, flavor, id });
        await buildCheckImage({ root, run, flavor, id, dockerfilePath });
        const { names, mirakurunPath } = await startServer({ root, run, flavor, id });
        const expectedVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
        const elapsedMs = await probeHttp({ run, names, expectedVersion, deadlineMs: probeDeadlineMs, sleep, now });
        facts = { names, mirakurunPath, expectedVersion, elapsedMs, ...(await inspectServerShape(run, names)) };
    } catch (error) {
        primary = error;
    }
    try {
        await cleanupResources({ run, id });
    } catch (error) {
        const earlier = primary === undefined ? '' : ` (earlier failure: ${primary.message})`;
        throw new DockerImageCheckError('cleanup-failed', `${error.message}${earlier}`);
    }
    if (primary !== undefined) {
        throw primary;
    }
    return facts;
}
