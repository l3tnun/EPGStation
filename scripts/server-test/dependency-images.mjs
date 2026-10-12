/**
 * Docker image の確認が使う依存 image の計画と、その用意（外部取得）。
 *
 * 確認の本体は外部へ取りに行かない。外部から取る処理（base image の pull、OS の package
 * （apt-get / apk・pip）、npm ci）はすべてここにあり、`prepare-dependency-images.mjs` という
 * 本体の前の専用 step からだけ呼ばれる。本体は、ここが決める tag の image が手元にあることを
 * `docker image inspect` で確かめるだけで、無ければ取得せずに失敗する。
 *
 * 層は製品の `Dockerfile.debian`・`Dockerfile.alpine` から導く。各 builder stage（`client-builder`・
 * `server-builder`）で、`FROM` から最初の行頭 `COPY . `（ソース全体の copy）の直前までを依存の部分と
 * する（comment と空行は除く）。層の Dockerfile を手書きで持たない。
 *   1. OS の package の層（server 用だけ）: 依存の部分のうち、最初の `WORKDIR` の直前まで。
 *      tag は層の内容（base の digest を含む）から決まる。lock file が変わっても作り直さない。
 *   2. npm の層: 1 の層（client 用は OS の package を使わないので base 自身）の上に、依存の部分の
 *      残りと manifest（`package.json`・`package-lock.json`）で `npm ci` する。tag はこの層の
 *      内容（1 の層の tag を含む）と manifest の path・sha256 から決まる。lock file が変わると、
 *      変わった側のこの層だけが作り直される。
 *
 * この module は repository の中身から計画を計算するだけの純粋な部分と、注入された `run` で docker を
 * 呼ぶ部分に分かれている。tag の計算は `scripts/ci-rehearsal/deps-image-tags.mjs`（古い image の削除）も使う。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DOCKERFILES = Object.freeze(['Dockerfile.debian', 'Dockerfile.alpine']);
const IMAGE_ID = /^(?:sha256:)?[0-9a-f]{64}$/u;
const PINNED_REF = /^(.+)@(sha256:[0-9a-f]{64})$/u;

/** builder stage の名前と、その stage が入れる manifest。server 用だけが OS の package の層を持つ。 */
const BUILDER_STAGES = Object.freeze({
    'client-builder': {
        kind: 'client',
        manifests: ['client/package.json', 'client/package-lock.json'],
    },
    'server-builder': {
        kind: 'server',
        manifests: ['package.json', 'package-lock.json'],
    },
});

/** 計画を立てられない（Dockerfile から digest や層が決まらない）。入力の誤りで、取得の失敗ではない。 */
export class DependencyImagePlanError extends Error {
    constructor(reason, message) {
        super(message ?? reason);
        this.name = 'DependencyImagePlanError';
        this.reason = reason;
    }
}

/** 外部からの取得が、決まった回数と時間のうちに成功しなかった。確認の失敗とは別の理由。 */
export class DependencyFetchError extends Error {
    constructor(what, detail) {
        super(`${what}: ${detail}`);
        this.name = 'DependencyFetchError';
        this.reason = 'dependency-images-fetch-failed';
        this.what = what;
        this.detail = detail;
    }
}

/** 取得の試行回数と、試行ごとの上限時間。延ばさない。 */
export const FETCH_ATTEMPTS = 3;
export const FETCH_RETRY_DELAY_MS = 15_000;
export const FETCH_TIMEOUT_MS = Object.freeze({
    pull: 600_000,
    osBuild: 900_000,
    npmBuild: 1_800_000,
});

function hash12(parts) {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(part);
        hash.update('\0');
    }
    return hash.digest('hex').slice(0, 12);
}

function sha256Hex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Dockerfile を stage ごとの行に分ける。`FROM` の前の行（`ARG` など）は stage に含めない。 */
function parseStages(file, text) {
    const lines = text.split(/\r?\n/u);
    const stages = [];
    lines.forEach((line, index) => {
        const match = /^FROM (?:--platform=\S+ )?(\S+)(?: AS (\S+))?\s*$/u.exec(line);
        if (match === null) {
            // 標準の形でない FROM（小文字、余分な空白など）を黙って読み飛ばすと、その base を取りこぼす。
            if (/^FROM(?:\s|$)/iu.test(line)) {
                throw new DependencyImagePlanError(
                    'from-line-malformed',
                    `${file}:${index + 1} has a FROM line this tool cannot read: ${line}`,
                );
            }
        } else {
            stages.push({ file, ref: match[1], name: match[2], from: index, end: lines.length, lines });
        }
    });
    stages.forEach((stage, index) => {
        if (index + 1 < stages.length) {
            stage.end = stages[index + 1].from;
        }
    });
    return stages;
}

/**
 * 製品の Dockerfile が固定している base を、出現順に返す。外から取る `FROM` は `<tag>@sha256:...`
 * でなければならず、同じ tag が 2 つの固定で別の digest なら失敗する。
 */
function collectBases(parsed) {
    const byTag = new Map();
    const bases = [];
    for (const { stages } of parsed) {
        const names = new Set();
        for (const stage of stages) {
            const earlier = names.has(stage.ref);
            if (stage.name !== undefined) {
                names.add(stage.name);
            }
            if (earlier) {
                continue;
            }
            const pinned = PINNED_REF.exec(stage.ref);
            if (pinned === null) {
                throw new DependencyImagePlanError(
                    'base-digest-missing',
                    `${stage.ref} is not pinned by a digest in ${stage.file}`,
                );
            }
            const known = byTag.get(pinned[1]);
            if (known !== undefined && known !== pinned[2]) {
                throw new DependencyImagePlanError(
                    'base-digest-conflict',
                    `${pinned[1]} is pinned to ${known} and ${pinned[2]} by the Dockerfiles`,
                );
            }
            if (known === undefined) {
                byTag.set(pinned[1], pinned[2]);
                bases.push({ tag: pinned[1], digest: pinned[2], ref: stage.ref });
            }
        }
    }
    return bases;
}

/** 1 つの builder stage の依存の部分を導く。導けない形は `DependencyImagePlanError`。 */
function dependencyPart(stage, spec) {
    const body = stage.lines.slice(stage.from + 1, stage.end);
    const copy = body.findIndex(line => line.startsWith('COPY . '));
    if (copy < 0) {
        throw new DependencyImagePlanError(
            'source-copy-missing',
            `${stage.file} ${stage.name} has no line that starts with "COPY . "`,
        );
    }
    const lines = body.slice(0, copy).filter(line => line.trim() !== '' && !/^\s*#/u.test(line));
    let osLines = [];
    let npmLines = lines;
    if (spec.kind === 'server') {
        const workdir = lines.findIndex(line => line.startsWith('WORKDIR '));
        if (workdir <= 0) {
            throw new DependencyImagePlanError(
                'os-layer-missing',
                `${stage.file} ${stage.name} has no OS package lines before its first WORKDIR`,
            );
        }
        osLines = lines.slice(0, workdir);
        npmLines = lines.slice(workdir);
    }
    if (!npmLines.some(line => /\bnpm ci\b/u.test(line))) {
        throw new DependencyImagePlanError(
            'npm-ci-missing',
            `${stage.file} ${stage.name} has no npm ci before its source copy`,
        );
    }
    return { osLines, npmLines, copyLine: stage.from + 1 + copy };
}

function layerDockerfile(ref, lines) {
    return `FROM ${ref}\n${lines.join('\n')}\n`;
}

/**
 * 依存 image の計画。
 *
 * - `bases`: 製品の Dockerfile が固定している base（`ref` は `<tag>@<Dockerfile の digest>`）。
 * - `images`: build 順の依存 image。`layer` が `os` か `npm`。`npm` の層だけが確認の Dockerfile の
 *   `FROM` に使われる（`flavor` と `kind` ごとに 1 つ）。
 * - `stages`: 各 builder stage の依存の部分が占める行（`from` は `FROM` の行、`copy` は最初の
 *   `COPY . ` の行、どちらも 0 起点）と、その stage の npm の層の tag。
 *
 * tag は、OS の層が `epgstation-deps-os-<flavor>-<kind>:<h12>`（層の内容。base の digest を含む）、
 * npm の層が `epgstation-deps-<flavor>-<kind>:<h12>`（層の内容と manifest の内容。server 用の層は
 * OS の層の tag を含むので、OS の層が変わると npm の層の tag も変わる）。
 */
export function planDependencyImages(root) {
    const parsed = DOCKERFILES.map(file => ({
        file,
        flavor: file.slice('Dockerfile.'.length),
        stages: parseStages(file, readFileSync(join(root, file), 'utf8')),
    }));
    const bases = collectBases(parsed);
    const images = [];
    const stages = [];
    for (const { file, flavor, stages: fileStages } of parsed) {
        for (const [name, spec] of Object.entries(BUILDER_STAGES)) {
            const stage = fileStages.find(candidate => candidate.name === name);
            if (stage === undefined) {
                throw new DependencyImagePlanError('builder-stage-missing', `${file} has no ${name} stage`);
            }
            const part = dependencyPart(stage, spec);
            const kind = `${flavor}-${spec.kind}`;
            let fromRef = stage.ref;
            if (part.osLines.length > 0) {
                const dockerfile = layerDockerfile(stage.ref, part.osLines);
                const tag = `epgstation-deps-os-${kind}:${hash12(['os-layer', kind, dockerfile])}`;
                images.push({ kind, layer: 'os', tag, dockerfile, baseRef: stage.ref, manifests: [] });
                fromRef = tag;
            }
            const dockerfile = layerDockerfile(fromRef, part.npmLines);
            const manifests = spec.manifests.map(path => ({ path, sha256: sha256Hex(readFileSync(join(root, path))) }));
            const tag = `epgstation-deps-${kind}:${hash12([
                'npm-layer',
                kind,
                dockerfile,
                ...manifests.flatMap(manifest => [manifest.path, manifest.sha256]),
            ])}`;
            images.push({ kind, layer: 'npm', tag, dockerfile, baseRef: stage.ref, manifests });
            stages.push({ file, flavor, stage: name, kind, from: stage.from, copy: part.copyLine, npmTag: tag });
        }
    }
    return { bases, images, stages };
}

/** 現在の manifest に対する依存 image の tag（両方の層）。古い image の削除が使う。 */
export function dependencyImageTags(root) {
    return planDependencyImages(root).images.map(image => image.tag);
}

async function isPresent(run, ref) {
    const inspected = await run(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref], { timeoutMs: 60_000 });
    return inspected.code === 0 && IMAGE_ID.test(String(inspected.stdout).trim());
}

function tail(text) {
    const trimmed = String(text ?? '').trim();
    return trimmed.length > 600 ? `...${trimmed.slice(-600)}` : trimmed;
}

async function withFetchRetry({ what, attempt, sleep, log, attempts, delayMs }) {
    let detail = 'not attempted';
    for (let n = 1; n <= attempts; n += 1) {
        const result = await attempt();
        if (result.code === 0) {
            return;
        }
        detail =
            result.code === null ? `timed out: ${tail(result.stderr)}` : `exit ${result.code}: ${tail(result.stderr)}`;
        log(`deps-prepare: ${what} failed (attempt ${n}/${attempts}): ${detail}`);
        if (n < attempts) {
            await sleep(delayMs);
        }
    }
    throw new DependencyFetchError(what, detail);
}

/**
 * 依存 image を手元に揃える。外部への取得はここだけ。
 *
 * 揃っているものには何もしない（`docker image inspect` だけ）。無いものだけを、base は
 * Dockerfile の digest で pull、層は `docker buildx build` で build する。取得は `attempts` 回まで、1 回ごとに上限時間を持ち、
 * 超えたら `DependencyFetchError` で止める。
 *
 * `run(argv, { timeoutMs })` は `{ code, stdout, stderr }` を返す（時間切れは `code: null`）。
 */
export async function prepareDependencyImages({
    root,
    run,
    sleep,
    log = () => {},
    attempts = FETCH_ATTEMPTS,
    delayMs = FETCH_RETRY_DELAY_MS,
}) {
    const plan = planDependencyImages(root);
    const report = { present: [], pulled: [], built: [] };
    const pullIfAbsent = async (name, ref) => {
        if (await isPresent(run, ref)) {
            report.present.push(name);
            return;
        }
        await withFetchRetry({
            what: `pull ${ref}`,
            attempt: () => run(['docker', 'pull', ref], { timeoutMs: FETCH_TIMEOUT_MS.pull }),
            sleep,
            log,
            attempts,
            delayMs,
        });
        if (!(await isPresent(run, ref))) {
            throw new DependencyFetchError(`pull ${ref}`, 'the image is not in the local store after the pull');
        }
        report.pulled.push(name);
    };
    const seen = new Set();
    for (const base of plan.bases) {
        if (!seen.has(base.ref)) {
            seen.add(base.ref);
            await pullIfAbsent(base.ref, base.ref);
        }
    }
    for (const image of plan.images) {
        if (await isPresent(run, image.tag)) {
            report.present.push(image.tag);
            continue;
        }
        const artifacts = join(root, 'test', 'server', '.artifacts');
        mkdirSync(artifacts, { recursive: true });
        const work = mkdtempSync(join(artifacts, 'deps-prepare-'));
        try {
            const context = join(work, 'context');
            mkdirSync(context);
            // manifest は製品の配置どおりに置く。製品の `COPY ... package*.json` がそのまま通る。
            for (const manifest of image.manifests) {
                mkdirSync(dirname(join(context, manifest.path)), { recursive: true });
                writeFileSync(join(context, manifest.path), readFileSync(join(root, manifest.path)));
            }
            const dockerfilePath = join(work, 'Dockerfile');
            writeFileSync(dockerfilePath, image.dockerfile);
            await withFetchRetry({
                what: `build ${image.tag}`,
                attempt: () =>
                    run(
                        [
                            'docker',
                            'buildx',
                            'build',
                            '--no-cache',
                            '--pull=false',
                            '--load',
                            '-f',
                            dockerfilePath,
                            '-t',
                            image.tag,
                            context,
                        ],
                        { timeoutMs: image.layer === 'os' ? FETCH_TIMEOUT_MS.osBuild : FETCH_TIMEOUT_MS.npmBuild },
                    ),
                sleep,
                log,
                attempts,
                delayMs,
            });
            if (!(await isPresent(run, image.tag))) {
                throw new DependencyFetchError(
                    `build ${image.tag}`,
                    'the image is not in the local store after the build',
                );
            }
            report.built.push(image.tag);
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }
    return report;
}
