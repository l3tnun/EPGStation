/**
 * Docker image の確認が使う依存 image の計画と、その用意（外部取得）。
 *
 * 確認の本体は外部へ取りに行かない。外部から取る処理（base image の pull、OS の package
 * （apt-get / apk）、npm ci）はすべてここにあり、`prepare-dependency-images.mjs` という
 * 本体の前の専用 step からだけ呼ばれる。本体は、ここが決める tag の image が手元にあることを
 * `docker image inspect` で確かめるだけで、無ければ取得せずに失敗する。
 *
 * レイヤは製品の `Dockerfile` と `docker-bake.json` から導く。bake の定義の `group.default.targets` の
 * target（`debian`・`alpine`）を flavor とし、その `args` で `Dockerfile` の `FROM ${名前}` と値の無い
 * `ARG 名前` を埋める。各 builder stage（`client-builder`・`server-builder`・`server-prod-deps`）で、
 * `FROM` から最初の `npm ci` の行（`\` で続く行を含む）までを依存の部分とする（comment と空行は除く）。
 * レイヤの Dockerfile を手書きで持たない。
 *   1. OS の package のレイヤ（`server-prod-deps` だけ）: 依存の部分のうち、最初の `WORKDIR` の直前まで。
 *      tag はレイヤの内容（base の digest を含む）から決まる。lock file が変わっても作り直さない。
 *   2. npm のレイヤ: 1 のレイヤ（ほかの stage は OS の package を使わないので base 自身）の上に、依存の部分の
 *      残りと manifest（`package.json`・`package-lock.json`）で `npm ci` する。tag はこのレイヤの
 *      内容（1 のレイヤの tag を含む）と manifest の path・sha256 から決まる。lock file が変わると、
 *      変わった側のこのレイヤだけが作り直される。
 * tag は flavor ではなくレイヤの内容で決まるので、どの flavor でも同じ内容のレイヤ（`client-builder`・
 * `server-builder`）は 1 つの tag になり、1 回だけ用意される。
 *
 * この module は repository の中身から計画を計算するだけの純粋な部分と、注入された `run` で docker を
 * 呼ぶ部分に分かれている。tag の計算は `scripts/ci-rehearsal/deps-image-tags.mjs`（古い image の削除）も使う。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DOCKERFILE = 'Dockerfile';
const BAKE_FILE = 'docker-bake.json';
const IMAGE_ID = /^(?:sha256:)?[0-9a-f]{64}$/u;
const PINNED_REF = /^(.+)@(sha256:[0-9a-f]{64})$/u;
const ARG_REF = /^\$\{(\w+)\}$/u;

/**
 * builder stage の名前と、その stage のレイヤの kind と manifest。`os` の stage だけが OS の package のレイヤを
 * 持つ。
 */
const BUILDER_STAGES = Object.freeze({
    'client-builder': {
        kind: 'client',
        manifests: ['client/package.json', 'client/package-lock.json'],
    },
    'server-builder': {
        kind: 'server-build',
        manifests: ['package.json', 'package-lock.json'],
    },
    'server-prod-deps': {
        kind: 'server-prod',
        manifests: ['package.json', 'package-lock.json'],
        os: true,
    },
});

/** 計画を立てられない（Dockerfile から digest やレイヤが決まらない）。入力の誤りで、取得の失敗ではない。 */
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
 * bake の定義の target を、`group.default.targets` の順に `{ flavor, args }` で返す。target の名前は
 * 重複せず、target は object で、`args` は文字列の値だけを持つ object でなければならない。
 */
function readBakeTargets(root) {
    let bake;
    try {
        bake = JSON.parse(readFileSync(join(root, BAKE_FILE), 'utf8'));
    } catch (error) {
        throw new DependencyImagePlanError('bake-definition-invalid', `${BAKE_FILE} cannot be read: ${error.message}`);
    }
    const names = bake?.group?.default?.targets;
    if (!Array.isArray(names) || names.length === 0 || new Set(names).size !== names.length) {
        throw new DependencyImagePlanError(
            'bake-definition-invalid',
            `${BAKE_FILE} has no group.default.targets or repeats a name`,
        );
    }
    return names.map(name => {
        const target = bake.target?.[name];
        if (target === undefined) {
            throw new DependencyImagePlanError('bake-target-missing', `${BAKE_FILE} has no target ${name}`);
        }
        const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
        const args = isObject(target) ? (target.args ?? {}) : undefined;
        if (!isObject(args) || Object.values(args).some(value => typeof value !== 'string')) {
            throw new DependencyImagePlanError(
                'bake-definition-invalid',
                `${BAKE_FILE} target ${name} is not an object with string args`,
            );
        }
        return { flavor: name, args };
    });
}

/** `FROM` の参照を target の引数で解決する。`${名前}` 以外の参照はそのまま返す。 */
function resolveRef(ref, { flavor, args }) {
    const match = ARG_REF.exec(ref);
    if (match === null) {
        return ref;
    }
    const value = args[match[1]];
    if (value === undefined) {
        throw new DependencyImagePlanError(
            'base-arg-missing',
            `${DOCKERFILE} uses ${ref}, which target ${flavor} does not set`,
        );
    }
    return value;
}

/**
 * target ごとに、Dockerfile が外から取る base を解決し、出現順に返す。外から取る参照は
 * `<tag>@sha256:...` でなければならず、同じ tag が 2 つの固定で別の digest なら失敗する。
 */
function collectBases(targets, stages) {
    const byTag = new Map();
    const bases = [];
    for (const target of targets) {
        const names = new Set();
        for (const stage of stages) {
            const earlier = names.has(stage.ref);
            if (stage.name !== undefined) {
                names.add(stage.name);
            }
            if (earlier) {
                continue;
            }
            const ref = resolveRef(stage.ref, target);
            const pinned = PINNED_REF.exec(ref);
            if (pinned === null) {
                throw new DependencyImagePlanError(
                    'base-digest-missing',
                    `${ref} is not pinned by a digest (target ${target.flavor})`,
                );
            }
            const known = byTag.get(pinned[1]);
            if (known !== undefined && known !== pinned[2]) {
                throw new DependencyImagePlanError(
                    'base-digest-conflict',
                    `${pinned[1]} is pinned to ${known} and ${pinned[2]} by ${BAKE_FILE}`,
                );
            }
            if (known === undefined) {
                byTag.set(pinned[1], pinned[2]);
                bases.push({ tag: pinned[1], digest: pinned[2], ref });
            }
        }
    }
    return bases;
}

/** 1 つの builder stage の依存の部分を導く。導けない形は `DependencyImagePlanError`。 */
function dependencyPart(stage, spec) {
    const body = stage.lines.slice(stage.from + 1, stage.end);
    const npmCi = body.findIndex(line => !/^\s*#/u.test(line) && /\bnpm ci\b/u.test(line));
    if (npmCi < 0) {
        throw new DependencyImagePlanError('npm-ci-missing', `${stage.file} ${stage.name} has no npm ci`);
    }
    let rest = npmCi + 1;
    while (rest < body.length && body[rest - 1].trimEnd().endsWith('\\')) {
        rest += 1;
    }
    const lines = body.slice(0, rest).filter(line => line.trim() !== '' && !/^\s*#/u.test(line));
    let osLines = [];
    let npmLines = lines;
    if (spec.os) {
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
    return { osLines, npmLines, restLine: stage.from + 1 + rest };
}

/**
 * `ARG 名前` の行に target の引数の値を埋める（bake と同じく、target の値が既定値より優先する）。
 * レイヤは bake を通さずに build するため。target の値も既定値も無い `ARG` は入力の誤り。
 */
function fillArgs(lines, { flavor, args }) {
    return lines.map(line => {
        const match = /^ARG (\w+)(=.*)?$/u.exec(line);
        if (match === null || (args[match[1]] === undefined && match[2] !== undefined)) {
            return line;
        }
        if (args[match[1]] === undefined) {
            throw new DependencyImagePlanError(
                'build-arg-missing',
                `${DOCKERFILE} declares ARG ${match[1]}, which target ${flavor} does not set`,
            );
        }
        return `ARG ${match[1]}=${args[match[1]]}`;
    });
}

function layerDockerfile(ref, lines) {
    return `FROM ${ref}\n${lines.join('\n')}\n`;
}

/**
 * 依存 image の計画。
 *
 * - `targets`: bake の定義の target（`{ flavor, args }`）を `group.default.targets` の順で。
 * - `bases`: target の引数で解決した base（`ref` は `<tag>@<bake の定義の digest>`）。
 * - `images`: build 順の依存 image。`layer` が `os` か `npm`。`flavors` はそのレイヤを使う flavor。`npm` のレイヤ
 *   だけが確認の Dockerfile の `FROM` に使われる。
 * - `stages`: flavor ごとの各 builder stage の依存の部分が占める行（`from` は `FROM` の行、`rest` は
 *   依存の部分の次の行、どちらも 0 起点）と、その stage の npm のレイヤの tag。
 *
 * tag は、OS のレイヤが `epgstation-deps-os-<kind>:<h12>`（レイヤの内容。base の digest を含む）、npm のレイヤが
 * `epgstation-deps-<kind>:<h12>`（レイヤの内容と manifest の内容。OS のレイヤを持つ stage は OS のレイヤの tag を
 * 含むので、OS のレイヤが変わると npm のレイヤの tag も変わる）。
 */
export function planDependencyImages(root) {
    const targets = readBakeTargets(root);
    const parsed = parseStages(DOCKERFILE, readFileSync(join(root, DOCKERFILE), 'utf8'));
    const bases = collectBases(targets, parsed);
    const images = [];
    const byTag = new Map();
    const addImage = (flavor, image) => {
        const known = byTag.get(image.tag);
        if (known === undefined) {
            const added = { ...image, flavors: [flavor] };
            byTag.set(image.tag, added);
            images.push(added);
        } else if (!known.flavors.includes(flavor)) {
            known.flavors.push(flavor);
        }
    };
    const stages = [];
    for (const target of targets) {
        for (const [name, spec] of Object.entries(BUILDER_STAGES)) {
            const stage = parsed.find(candidate => candidate.name === name);
            if (stage === undefined) {
                throw new DependencyImagePlanError('builder-stage-missing', `${DOCKERFILE} has no ${name} stage`);
            }
            const baseRef = resolveRef(stage.ref, target);
            const part = dependencyPart(stage, spec);
            let fromRef = baseRef;
            if (part.osLines.length > 0) {
                const dockerfile = layerDockerfile(baseRef, fillArgs(part.osLines, target));
                const tag = `epgstation-deps-os-${spec.kind}:${hash12(['os-layer', spec.kind, dockerfile])}`;
                addImage(target.flavor, { kind: spec.kind, layer: 'os', tag, dockerfile, baseRef, manifests: [] });
                fromRef = tag;
            }
            const dockerfile = layerDockerfile(fromRef, fillArgs(part.npmLines, target));
            const manifests = spec.manifests.map(path => ({ path, sha256: sha256Hex(readFileSync(join(root, path))) }));
            const tag = `epgstation-deps-${spec.kind}:${hash12([
                'npm-layer',
                spec.kind,
                dockerfile,
                ...manifests.flatMap(manifest => [manifest.path, manifest.sha256]),
            ])}`;
            addImage(target.flavor, { kind: spec.kind, layer: 'npm', tag, dockerfile, baseRef, manifests });
            stages.push({
                flavor: target.flavor,
                stage: name,
                kind: spec.kind,
                from: stage.from,
                rest: part.restLine,
                npmTag: tag,
            });
        }
    }
    return { targets, bases, images, stages };
}

/** 計画の中の flavor の target の引数。bake の定義に無い flavor は `bake-target-missing`。 */
export function targetArgs(plan, flavor) {
    const target = plan.targets.find(entry => entry.flavor === flavor);
    if (target === undefined) {
        throw new DependencyImagePlanError('bake-target-missing', `${BAKE_FILE} has no target ${flavor}`);
    }
    return target.args;
}

/** 現在の manifest に対する依存 image の tag（両方のレイヤ）。古い image の削除が使う。 */
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
 * Dockerfile の digest で pull、レイヤは `docker buildx build` で build する。取得は `attempts` 回まで、1 回ごとに上限時間を持ち、
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
