import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    DependencyFetchError,
    DependencyImagePlanError,
    FETCH_ATTEMPTS,
    FETCH_RETRY_DELAY_MS,
    FETCH_TIMEOUT_MS,
    dependencyImageTags,
    planDependencyImages,
    prepareDependencyImages,
} from '../../../scripts/server-test/dependency-images.mjs';
import {
    BUILD_TIMEOUT_MS,
    DEV_PACKAGE_SAMPLES,
    DockerImageCheckError,
    PREPARE_COMMAND,
    RUNTIME_PACKAGE_SAMPLE,
    STUB_PORT,
    assertNoRegistryAccess,
    buildCheckImage,
    checkResourceNames,
    cleanupResources,
    checkImageName,
    createDockerLedger,
    deriveImageDockerfile,
    probeHttp,
    runImageCheck,
    verifyPrepared,
    writeImageDockerfile,
} from '../../../scripts/server-test/docker-image-check.mjs';
import { main as prepareCliMain } from '../../../scripts/server-test/prepare-dependency-images.mjs';

const repositoryRoot = new URL('../../../', import.meta.url).pathname.replace(/\/$/u, '');
const IMAGE_ID = `sha256:${'a1'.repeat(32)}`;
const PINNED_FROM = /^FROM (?:--platform=\S+ )?(\S+)@(sha256:[0-9a-f]{64})/gmu;

interface RunResult {
    code: number | null;
    stdout: string;
    stderr: string;
}
type Run = (argv: string[], options?: { timeoutMs: number }) => Promise<RunResult>;

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** 本物の Dockerfile.* を写し、小さな manifest を置いた作業用の repository root。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-dependency-images-'));
    roots.push(root);
    await cp(join(repositoryRoot, 'Dockerfile.debian'), join(root, 'Dockerfile.debian'));
    await cp(join(repositoryRoot, 'Dockerfile.alpine'), join(root, 'Dockerfile.alpine'));
    await mkdir(join(root, 'client'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"name":"server"}\n');
    await writeFile(join(root, 'package-lock.json'), '{"lock":"server-1"}\n');
    await writeFile(join(root, 'client', 'package.json'), '{"name":"client"}\n');
    await writeFile(join(root, 'client', 'package-lock.json'), '{"lock":"client-1"}\n');
    return root;
}

/** fixture の Dockerfile の文字列を置き換える。置き換え対象が無ければ test の誤りとして失敗する。 */
async function editDockerfile(root: string, name: string, edit: (text: string) => string): Promise<void> {
    const path = join(root, name);
    const before = await readFile(path, 'utf8');
    const after = edit(before);
    expect(after, `${name} edit`).not.toBe(before);
    await writeFile(path, after);
}

function tagsByKind(root: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const image of planDependencyImages(root).images) {
        result[`${image.kind}/${image.layer}`] = image.tag;
    }
    return result;
}

function changed(before: Record<string, string>, after: Record<string, string>): string[] {
    return Object.keys(before)
        .filter(key => before[key] !== after[key])
        .sort();
}

function pinnedBases(text: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const match of text.matchAll(PINNED_FROM)) {
        result.set(match[1], match[2]);
    }
    return result;
}

function planFailure(root: string): unknown {
    try {
        planDependencyImages(root);
    } catch (error) {
        return error;
    }
    return undefined;
}

describe('依存の計画: base は製品の Dockerfile が固定した digest から読む', () => {
    it('[AR-10.2] 両方の Dockerfile の固定された FROM をすべて base にし、ref は <tag>@<Dockerfile の digest> で tag だけの ref は無い', () => {
        const pinned = new Map<string, string>();
        for (const dockerfile of ['Dockerfile.debian', 'Dockerfile.alpine']) {
            for (const [tag, digest] of pinnedBases(readFileSync(join(repositoryRoot, dockerfile), 'utf8'))) {
                pinned.set(tag, digest);
            }
        }
        const plan = planDependencyImages(repositoryRoot);
        expect(plan.bases.map(base => base.tag).sort()).toEqual([...pinned.keys()].sort());
        for (const base of plan.bases) {
            expect(base.digest, base.tag).toBe(pinned.get(base.tag));
            expect(base.ref).toBe(`${base.tag}@${base.digest}`);
            expect(base.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        }
        expect(new Set(plan.bases.map(base => base.ref)).size).toBe(plan.bases.length);
    });

    it('[AR-10.2] 同じ tag を 2 つの Dockerfile が別の digest に固定していれば base-digest-conflict で失敗する', async () => {
        const root = await fixtureRoot();
        await editDockerfile(
            root,
            'Dockerfile.alpine',
            text => `FROM node:24-bookworm@sha256:${'0'.repeat(64)} AS stray\n${text}`,
        );
        expect(planFailure(root)).toMatchObject({ name: 'DependencyImagePlanError', reason: 'base-digest-conflict' });
    });

    it('[AR-10.2] digest で固定されていない外部の FROM は base-digest-missing で失敗する', async () => {
        const root = await fixtureRoot();
        await editDockerfile(root, 'Dockerfile.debian', text =>
            text.replace(/node:24-bookworm-slim@sha256:[0-9a-f]{64}/u, 'scratch'),
        );
        expect(planFailure(root)).toBeInstanceOf(DependencyImagePlanError);
        expect(planFailure(root)).toMatchObject({ reason: 'base-digest-missing' });
    });

    it('[AR-10.2] 先に定義した stage を FROM に使う行は固定の対象にしない', async () => {
        const root = await fixtureRoot();
        await editDockerfile(root, 'Dockerfile.debian', text => `${text}\nFROM server-builder\n`);
        expect(planFailure(root)).toBeUndefined();
    });
});

describe('依存の計画: 層は製品の Dockerfile から導く', () => {
    it('[AR-10.6] server は OS の層と npm の層、client は npm の層だけを、Dockerfile の出現順（debian、alpine）で計画する', async () => {
        const root = await fixtureRoot();
        const plan = planDependencyImages(root);
        expect(plan.images.map(image => `${image.kind}/${image.layer}`)).toEqual([
            'debian-client/npm',
            'debian-server/os',
            'debian-server/npm',
            'alpine-client/npm',
            'alpine-server/os',
            'alpine-server/npm',
        ]);
        for (const image of plan.images) {
            expect(image.tag).toMatch(
                image.layer === 'os'
                    ? /^epgstation-deps-os-(?:debian|alpine)-server:[0-9a-f]{12}$/u
                    : /^epgstation-deps-(?:debian|alpine)-(?:client|server):[0-9a-f]{12}$/u,
            );
        }
        expect(new Set(plan.images.map(image => image.tag)).size).toBe(plan.images.length);
        expect(dependencyImageTags(root)).toEqual(plan.images.map(image => image.tag));
    });

    it('[AR-10.2] 層の Dockerfile は、FROM から最初の COPY . の直前までの comment と空行を除いた行を、そのまま持つ', async () => {
        const root = await fixtureRoot();
        const plan = planDependencyImages(root);
        for (const flavor of ['debian', 'alpine']) {
            const product = (await readFile(join(root, `Dockerfile.${flavor}`), 'utf8')).split('\n');
            for (const kind of ['client', 'server']) {
                const from = product.findIndex(line => line.includes(` AS ${kind}-builder`));
                const copy = product.findIndex((line, index) => index > from && line.startsWith('COPY . '));
                expect(copy, `${flavor} ${kind}`).toBeGreaterThan(from);
                const dependency = product
                    .slice(from + 1, copy)
                    .filter(line => line.trim() !== '' && !/^\s*#/u.test(line));
                const layers = plan.images.filter(image => image.kind === `${flavor}-${kind}`);
                const joined = layers
                    .flatMap(image => image.dockerfile.split('\n').slice(1))
                    .filter(line => line !== '');
                expect(joined, `${flavor} ${kind}`).toEqual(dependency);
                // 先頭の FROM は、外から取る base（--platform は外す）か、OS の層の tag。
                expect(layers[0].dockerfile.startsWith(`FROM ${layers[0].baseRef}\n`)).toBe(true);
                expect(layers[0].baseRef).not.toContain('--platform');
            }
        }
    });

    it('[AR-10.6] OS の層は最初の WORKDIR の直前までで manifest に触れず、npm の層は OS の層の tag の上に npm ci する', async () => {
        const root = await fixtureRoot();
        const plan = planDependencyImages(root);
        const image = (kind: string, layer: string) => {
            const found = plan.images.find(entry => entry.kind === kind && entry.layer === layer);
            expect(found, `${kind}/${layer}`).toBeDefined();
            return found!;
        };
        const debianOs = image('debian-server', 'os');
        const debianNpm = image('debian-server', 'npm');
        expect(debianOs.dockerfile).toContain('apt-get install -y build-essential python3');
        expect(debianOs.dockerfile).not.toMatch(/WORKDIR|npm ci|package(?:-lock)?\.json/u);
        expect(debianOs.manifests).toEqual([]);
        expect(debianNpm.dockerfile.startsWith(`FROM ${debianOs.tag}\nWORKDIR /app\n`)).toBe(true);
        expect(debianNpm.dockerfile).toContain('npm ci --loglevel=info');
        expect(debianNpm.dockerfile).not.toMatch(/apt-get|apk add|pip install/u);
        expect(debianNpm.manifests.map(manifest => manifest.path)).toEqual(['package.json', 'package-lock.json']);

        const alpineOs = image('alpine-server', 'os');
        expect(alpineOs.dockerfile).toContain('apk add --no-cache g++ make pkgconf python3 py3-pip');
        expect(alpineOs.dockerfile).toContain('pip install --break-system-pack setuptools');
        expect(alpineOs.dockerfile).not.toContain('npm ci');
        expect(image('alpine-server', 'npm').dockerfile.startsWith(`FROM ${alpineOs.tag}\n`)).toBe(true);

        // client は OS の package を入れないので、base の上に直接 npm ci する。
        for (const kind of ['debian-client', 'alpine-client']) {
            const client = image(kind, 'npm');
            expect(client.dockerfile.startsWith(`FROM ${client.baseRef}\n`)).toBe(true);
            expect(client.dockerfile).toContain('npm ci --loglevel=info');
            expect(client.dockerfile).not.toMatch(/apt-get|apk add|pip install/u);
            expect(client.manifests.map(manifest => manifest.path)).toEqual([
                'client/package.json',
                'client/package-lock.json',
            ]);
            expect(plan.images.some(entry => entry.kind === kind && entry.layer === 'os')).toBe(false);
        }
    });

    it('[AR-10.5] 層の Dockerfile は Node の header の取得を持たない', () => {
        for (const image of planDependencyImages(repositoryRoot).images) {
            expect(image.dockerfile).not.toMatch(/headers|npm_config_tarball|curl/u);
        }
    });

    it('[AR-10.2] 各 builder stage の依存の部分が占める行と npm の層の tag を、確認の Dockerfile を導く側へ渡す', async () => {
        const root = await fixtureRoot();
        const plan = planDependencyImages(root);
        expect(plan.stages.map(stage => `${stage.flavor}/${stage.stage}`)).toEqual([
            'debian/client-builder',
            'debian/server-builder',
            'alpine/client-builder',
            'alpine/server-builder',
        ]);
        const tags = tagsByKind(root);
        for (const stage of plan.stages) {
            const lines = (await readFile(join(root, stage.file), 'utf8')).split('\n');
            expect(lines[stage.from]).toContain(` AS ${stage.stage}`);
            expect(lines[stage.copy].startsWith('COPY . ')).toBe(true);
            expect(stage.npmTag).toBe(tags[`${stage.kind}/npm`]);
        }
    });

    it('[AR-10.7] 同じ入力からは同じ tag になる', async () => {
        const root = await fixtureRoot();
        expect(tagsByKind(root)).toEqual(tagsByKind(root));
    });

    it('[AR-10.7] comment と空行だけの変更では tag が変わらない', async () => {
        const root = await fixtureRoot();
        const before = tagsByKind(root);
        await editDockerfile(root, 'Dockerfile.debian', text =>
            text.replace('WORKDIR /app\nCOPY', 'WORKDIR /app\n\n# note\nCOPY'),
        );
        expect(changed(before, tagsByKind(root))).toEqual([]);
    });
});

describe('依存の計画: 導けない形は終了 code 2 の入力の誤りにする', () => {
    const shapes: Array<[string, string, (text: string) => string, string]> = [
        [
            '小文字の from の行がある',
            'Dockerfile.debian',
            text => text.replace(/^FROM node:24-bookworm-slim@/mu, 'from node:24-bookworm-slim@'),
            'from-line-malformed',
        ],
        [
            'FROM の後の空白が 2 つ以上ある行がある',
            'Dockerfile.alpine',
            text => text.replace(/^FROM node:24-alpine@(sha256:[0-9a-f]{64})$/mu, 'FROM  node:24-alpine@$1'),
            'from-line-malformed',
        ],
        [
            'builder stage が無い',
            'Dockerfile.debian',
            text => text.replace(' AS server-builder', ' AS renamed'),
            'builder-stage-missing',
        ],
        [
            '行頭の COPY . が無い',
            'Dockerfile.alpine',
            text => text.replace(/^COPY \. \/app\/$/mu, 'COPY client /app/client/'),
            'source-copy-missing',
        ],
        [
            'server の依存の部分に WORKDIR が無い',
            'Dockerfile.debian',
            text => text.replace('WORKDIR /app\nCOPY package*.json', 'COPY package*.json'),
            'os-layer-missing',
        ],
        [
            'server の WORKDIR の前に OS の package の行が無い',
            'Dockerfile.alpine',
            text =>
                text
                    .replace(/^RUN apk add .*$/mu, '')
                    .replace(/^RUN pip install .*$/mu, '')
                    .replace(/^# node-sqlite3.*$/gmu, ''),
            'os-layer-missing',
        ],
        [
            'npm ci の行が無い',
            'Dockerfile.debian',
            text => text.replace(/^RUN npm ci --loglevel=info$/mu, 'RUN echo no'),
            'npm-ci-missing',
        ],
    ];

    it.each(shapes)('[AR-10.2][AR-10.9] %s', async (_name, dockerfile, edit, reason) => {
        const root = await fixtureRoot();
        await editDockerfile(root, dockerfile, edit);
        const failure = planFailure(root);
        expect(failure).toBeInstanceOf(DependencyImagePlanError);
        expect(failure).toMatchObject({ reason });
    });

    it('[AR-10.2][AR-10.9] prepare の入口は、導けない形を INVALID-INPUT の終了 code 2 にし、docker を呼ばない', async () => {
        const root = await fixtureRoot();
        await editDockerfile(root, 'Dockerfile.debian', text => text.replace(/^COPY \. \/app\/$/mu, 'COPY a /a'));
        const out: string[] = [];
        const err: string[] = [];
        const code = await prepareCliMain({
            root,
            out: { write: (text: string) => void out.push(text) } as unknown as NodeJS.WritableStream,
            err: { write: (text: string) => void err.push(text) } as unknown as NodeJS.WritableStream,
        });
        expect(code).toBe(2);
        expect(err.join('')).toContain('deps-prepare: INVALID-INPUT source-copy-missing');
        expect(out.join('')).toBe('');
    });
});

describe('依存の計画: lock file の変更で作り直す層', () => {
    it('[AR-10.7] server の lock の変更で、server の npm の層だけの tag が変わる（OS の層・client は変わらない）', async () => {
        const root = await fixtureRoot();
        const before = tagsByKind(root);
        await writeFile(join(root, 'package-lock.json'), '{"lock":"server-2"}\n');
        expect(changed(before, tagsByKind(root))).toEqual(['alpine-server/npm', 'debian-server/npm']);
    });

    it('[AR-10.7] server の package.json の変更でも、server の npm の層だけの tag が変わる', async () => {
        const root = await fixtureRoot();
        const before = tagsByKind(root);
        await writeFile(join(root, 'package.json'), '{"name":"server","version":"2"}\n');
        expect(changed(before, tagsByKind(root))).toEqual(['alpine-server/npm', 'debian-server/npm']);
    });

    it('[AR-10.7] client の lock の変更で、client の npm の層だけの tag が変わる', async () => {
        const root = await fixtureRoot();
        const before = tagsByKind(root);
        await writeFile(join(root, 'client', 'package-lock.json'), '{"lock":"client-2"}\n');
        expect(changed(before, tagsByKind(root))).toEqual(['alpine-client/npm', 'debian-client/npm']);
    });

    it('[AR-10.7] server の base の digest の変更で、その flavor の server の OS の層と npm の層だけが変わる', async () => {
        const root = await fixtureRoot();
        const before = tagsByKind(root);
        const pinned = pinnedBases(await readFile(join(root, 'Dockerfile.debian'), 'utf8')).get('node:24-bookworm')!;
        await editDockerfile(root, 'Dockerfile.debian', text => text.replace(pinned, `sha256:${'f'.repeat(64)}`));
        expect(changed(before, tagsByKind(root))).toEqual(['debian-server/npm', 'debian-server/os']);
    });

    it('[AR-10.7] 実リポジトリの tag は、古い image の削除のために OS の層 2 つと npm の層 4 つを列挙する', () => {
        const tags = dependencyImageTags(repositoryRoot);
        expect(tags.filter(tag => tag.startsWith('epgstation-deps-os-'))).toHaveLength(2);
        expect(tags.filter(tag => !tag.startsWith('epgstation-deps-os-'))).toHaveLength(4);
    });
});

/**
 * docker の代役。image の一覧を持ち、pull と buildx build が成功すると増える。呼ばれた argv を
 * すべて記録する。`failing` に入る操作（'pull' / 'buildx'）は、成功させず失敗させる。
 */
function fakeDocker(initial: string[], failing: { pull?: RunResult; buildx?: RunResult } = {}) {
    const store = new Set(initial);
    const calls: string[][] = [];
    const builds: Array<{ tag: string; argv: string[]; dockerfile: string; contextFiles: string[] }> = [];
    const run: Run = async argv => {
        calls.push(argv);
        const [, sub, ...rest] = argv;
        if (sub === 'image' && rest[0] === 'inspect') {
            const ref = rest[rest.length - 1];
            return store.has(ref)
                ? { code: 0, stdout: `${IMAGE_ID}\n`, stderr: '' }
                : { code: 1, stdout: '', stderr: 'No such image' };
        }
        if (sub === 'pull') {
            if (failing.pull !== undefined) {
                return failing.pull;
            }
            store.add(rest[0]);
            return { code: 0, stdout: '', stderr: '' };
        }
        if (sub === 'buildx') {
            if (failing.buildx !== undefined) {
                return failing.buildx;
            }
            const tag = rest[rest.indexOf('-t') + 1];
            const context = rest[rest.length - 1];
            const files: string[] = [];
            const walk = (dir: string, prefix: string): void => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    if (entry.isDirectory()) {
                        walk(join(dir, entry.name), `${prefix}${entry.name}/`);
                    } else {
                        files.push(`${prefix}${entry.name}`);
                    }
                }
            };
            walk(context, '');
            builds.push({
                tag,
                argv,
                dockerfile: readFileSync(rest[rest.indexOf('-f') + 1], 'utf8'),
                contextFiles: files.sort(),
            });
            store.add(tag);
            return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 97, stdout: '', stderr: `unexpected: ${argv.join(' ')}` };
    };
    return { run, calls, builds, store };
}

function allImageRefs(root: string): string[] {
    const plan = planDependencyImages(root);
    return [...plan.bases.map(base => base.ref), ...plan.images.map(image => image.tag)];
}

function noSleep() {
    const slept: number[] = [];
    return { slept, sleep: async (ms: number) => void slept.push(ms) };
}

describe('依存の準備: 外部取得をする唯一の場所', () => {
    it('[AR-10.8] すべて手元にあれば docker image inspect だけを呼び、何も取得せず、作業 directory も作らない', async () => {
        const root = await fixtureRoot();
        const docker = fakeDocker(allImageRefs(root));
        const { sleep, slept } = noSleep();
        const report = await prepareDependencyImages({ root, run: docker.run, sleep });
        expect(report.pulled).toEqual([]);
        expect(report.built).toEqual([]);
        expect(docker.calls.length).toBeGreaterThan(0);
        expect(docker.calls.every(call => call[0] === 'docker' && call[1] === 'image' && call[2] === 'inspect')).toBe(
            true,
        );
        expect(slept).toEqual([]);
        expect(existsSync(join(root, 'test'))).toBe(false);
    });

    it('[AR-10.5][AR-10.6] 空の状態からは、各 base を Dockerfile の digest で pull し、OS の層をその上の npm の層より先に build する。取得は pull と build だけ', async () => {
        const root = await fixtureRoot();
        const docker = fakeDocker([]);
        const { sleep } = noSleep();
        const report = await prepareDependencyImages({ root, run: docker.run, sleep });
        const plan = planDependencyImages(root);
        const pulls = docker.calls.filter(call => call[1] === 'pull').map(call => call[2]);
        expect(pulls).toEqual(plan.bases.map(base => base.ref));
        for (const pull of pulls) {
            expect(pull).toMatch(/^node:[^@]+@sha256:[0-9a-f]{64}$/u);
        }
        expect(docker.builds.map(build => build.tag)).toEqual(plan.images.map(image => image.tag));
        expect(report.built).toEqual(plan.images.map(image => image.tag));
        for (const build of docker.builds) {
            const planned = plan.images.find(image => image.tag === build.tag)!;
            expect(build.dockerfile).toBe(planned.dockerfile);
            // 層の context には manifest だけを製品の配置どおりに置く。
            expect(build.contextFiles).toEqual(planned.manifests.map(manifest => manifest.path).sort());
            expect(build.argv).toEqual(
                expect.arrayContaining(['docker', 'buildx', 'build', '--no-cache', '--pull=false', '--load']),
            );
        }
        // 呼んだ docker は inspect・pull・buildx build だけで、外部の取得に使う他の command は無い。
        expect(docker.calls.every(call => call[0] === 'docker')).toBe(true);
        expect(new Set(docker.calls.map(call => (call[1] === 'image' ? 'inspect' : call[1])))).toEqual(
            new Set(['inspect', 'pull', 'buildx']),
        );
        // 一時 file は残らない。
        expect(
            readdirSync(join(root, 'test', 'server', '.artifacts')).filter(name => name.startsWith('deps-prepare-')),
        ).toEqual([]);
    });

    it('[AR-10.7] lock file の更新では、その lock の npm の層だけを build する。pull せず、OS の層は作り直さない', async () => {
        const root = await fixtureRoot();
        const docker = fakeDocker(allImageRefs(root));
        await writeFile(join(root, 'package-lock.json'), '{"lock":"server-2"}\n');
        const { sleep } = noSleep();
        const report = await prepareDependencyImages({ root, run: docker.run, sleep });
        const after = tagsByKind(root);
        expect(report.pulled).toEqual([]);
        expect(report.built).toEqual([after['debian-server/npm'], after['alpine-server/npm']]);
        expect(docker.calls.some(call => call[1] === 'pull')).toBe(false);
        for (const build of docker.builds) {
            expect(build.dockerfile).not.toMatch(/apt-get|apk add/u);
        }
    });

    it('[AR-10.9] build した後に image が手元に無ければ、取得の失敗にする', async () => {
        const root = await fixtureRoot();
        const inner = fakeDocker([]);
        const run: Run = async argv => {
            const result = await inner.run(argv);
            if (argv[1] === 'buildx') {
                inner.store.delete(argv[argv.indexOf('-t') + 1]);
            }
            return result;
        };
        const { sleep } = noSleep();
        await expect(prepareDependencyImages({ root, run, sleep })).rejects.toMatchObject({
            reason: 'dependency-images-fetch-failed',
            detail: expect.stringContaining('not in the local store after the build'),
        });
    });

    it('[AR-10.9] pull した後に image が手元に無ければ、取得の失敗にする', async () => {
        const root = await fixtureRoot();
        const inner = fakeDocker([]);
        const run: Run = async argv => {
            if (argv[1] === 'pull') {
                return { code: 0, stdout: '', stderr: '' };
            }
            return inner.run(argv);
        };
        const { sleep } = noSleep();
        await expect(prepareDependencyImages({ root, run, sleep })).rejects.toMatchObject({
            reason: 'dependency-images-fetch-failed',
            detail: expect.stringContaining('not in the local store after the pull'),
        });
    });

    describe('取得に成功しなければ、固有の理由で止まる', () => {
        it('[AR-10.9] base の pull を決まった回数だけ試し、間に決まった間隔を置き、何も build しない', async () => {
            const root = await fixtureRoot();
            const docker = fakeDocker([], { pull: { code: 1, stdout: '', stderr: 'read tcp: ECONNRESET' } });
            const { sleep, slept } = noSleep();
            const failure = await prepareDependencyImages({ root, run: docker.run, sleep }).catch(
                (error: unknown) => error,
            );
            expect(failure).toBeInstanceOf(DependencyFetchError);
            expect(failure).toMatchObject({ reason: 'dependency-images-fetch-failed' });
            expect((failure as DependencyFetchError).what).toMatch(/^pull node:[^@]+@sha256:/u);
            expect((failure as DependencyFetchError).detail).toContain('ECONNRESET');
            expect(docker.calls.filter(call => call[1] === 'pull')).toHaveLength(FETCH_ATTEMPTS);
            expect(slept).toEqual(Array.from({ length: FETCH_ATTEMPTS - 1 }, () => FETCH_RETRY_DELAY_MS));
            expect(docker.calls.some(call => call[1] === 'buildx')).toBe(false);
        });

        it('[AR-10.9] 時間切れは固有の detail で報告する', async () => {
            const root = await fixtureRoot();
            const docker = fakeDocker([], { pull: { code: null, stdout: '', stderr: '' } });
            const { sleep } = noSleep();
            await expect(prepareDependencyImages({ root, run: docker.run, sleep })).rejects.toMatchObject({
                reason: 'dependency-images-fetch-failed',
                detail: expect.stringContaining('timed out'),
            });
        });

        it('[AR-10.9] 再試行が成功すれば成功する', async () => {
            const root = await fixtureRoot();
            const inner = fakeDocker(allImageRefs(root).filter(ref => !ref.startsWith('node:26-alpine@')));
            let failedOnce = false;
            const run: Run = async argv => {
                if (argv[1] === 'pull' && !failedOnce) {
                    failedOnce = true;
                    return { code: 1, stdout: '', stderr: 'transient' };
                }
                return inner.run(argv);
            };
            const { sleep, slept } = noSleep();
            const report = await prepareDependencyImages({ root, run, sleep });
            expect(report.pulled).toHaveLength(1);
            expect(slept).toEqual([FETCH_RETRY_DELAY_MS]);
        });

        it('[AR-10.9] 層の build の失敗は、層の名前と決まった試行回数で止まり、その上の層へ進まない', async () => {
            const root = await fixtureRoot();
            const plan = planDependencyImages(root);
            const docker = fakeDocker(
                plan.bases.map(base => base.ref),
                { buildx: { code: 1, stdout: '', stderr: 'npm error code ECONNRESET' } },
            );
            const { sleep } = noSleep();
            const failure = await prepareDependencyImages({ root, run: docker.run, sleep }).catch(
                (error: unknown) => error,
            );
            expect(failure).toBeInstanceOf(DependencyFetchError);
            expect((failure as DependencyFetchError).what).toBe(`build ${plan.images[0].tag}`);
            expect((failure as DependencyFetchError).detail).toContain('ECONNRESET');
            expect(docker.calls.filter(call => call[1] === 'buildx')).toHaveLength(FETCH_ATTEMPTS);
        });

        it('[AR-10.9] OS の層の build の失敗も、その層の名前で止まる', async () => {
            const root = await fixtureRoot();
            const plan = planDependencyImages(root);
            const docker = fakeDocker([...plan.bases.map(base => base.ref), plan.images[0].tag], {
                buildx: { code: 100, stdout: '', stderr: 'E: Unable to locate package' },
            });
            const { sleep } = noSleep();
            await expect(prepareDependencyImages({ root, run: docker.run, sleep })).rejects.toMatchObject({
                what: `build ${plan.images[1].tag}`,
            });
        });
    });

    it('[AR-10.9] 取得の回数・間隔・種類ごとの上限時間は固定されている', () => {
        expect(FETCH_ATTEMPTS).toBe(3);
        expect(FETCH_RETRY_DELAY_MS).toBe(15_000);
        expect(FETCH_TIMEOUT_MS).toEqual({ pull: 600_000, osBuild: 900_000, npmBuild: 1_800_000 });
    });

    it('[AR-10.5] build の上限時間は OS の層と npm の層で別の値を渡す', async () => {
        const root = await fixtureRoot();
        const timeouts: Array<[string, number | undefined]> = [];
        const inner = fakeDocker([]);
        const run: Run = async (argv, options) => {
            if (argv[1] === 'buildx') {
                timeouts.push([argv[argv.indexOf('-t') + 1], options?.timeoutMs]);
            }
            return inner.run(argv, options);
        };
        const { sleep } = noSleep();
        await prepareDependencyImages({ root, run, sleep });
        for (const image of planDependencyImages(root).images) {
            expect(timeouts).toContainEqual([
                image.tag,
                image.layer === 'os' ? FETCH_TIMEOUT_MS.osBuild : FETCH_TIMEOUT_MS.npmBuild,
            ]);
        }
    });
});

/** `prepare-dependency-images.mjs` を本物の process として起動する。docker は PATH の先頭の代役。 */
async function runPrepareCli(dockerScript: string, env: Record<string, string> = {}) {
    const binDir = await mkdtemp(join(tmpdir(), 'epgstation-prepare-cli-'));
    roots.push(binDir);
    await writeFile(
        join(binDir, 'docker'),
        `#!/bin/bash\nprintf '%s\\n' "$*" >> '${join(binDir, 'calls.log')}'\n${dockerScript}\n`,
    );
    await chmod(join(binDir, 'docker'), 0o755);
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [join(repositoryRoot, 'scripts/server-test/prepare-dependency-images.mjs')],
            {
                cwd: repositoryRoot,
                env: {
                    ...process.env,
                    PATH: `${binDir}:${process.env.PATH ?? ''}`,
                    EPGS_DEPS_PREPARE_RETRY_DELAY_MS: '0',
                    ...env,
                    NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE,
                },
            },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => (stdout += String(chunk)));
        child.stderr.on('data', chunk => (stderr += String(chunk)));
        child.on('error', reject);
        child.on('close', code => resolve({ code, stdout, stderr }));
    });
    const calls = (await readFile(join(binDir, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
    return { ...result, calls };
}

describe('prepare-dependency-images.mjs（本体の前の step）の終了 code', () => {
    it('[AR-10.8] すべて手元にあれば 0 で終わり、docker image inspect だけを呼ぶ', async () => {
        const result = await runPrepareCli(`echo '${IMAGE_ID}'`);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('deps-prepare: ready (present=');
        expect(result.stdout).toContain('pulled=0 built=0');
        expect(result.calls.length).toBeGreaterThan(0);
        expect(result.calls.every(call => call.startsWith('image inspect '))).toBe(true);
    }, 30_000);

    it('[AR-10.5] 取得の対象は base image、OS package、npm の依存関係だけで、gitleaks の image を見ない', async () => {
        const result = await runPrepareCli(`echo '${IMAGE_ID}'`);
        expect(result.calls.some(call => call.includes('gitleaks'))).toBe(false);
        const plan = planDependencyImages(repositoryRoot);
        expect(result.calls).toHaveLength(plan.bases.length + plan.images.length);
    }, 30_000);

    it('[AR-10.9] base を取得できなければ、build を始めずに固有の理由で 75 を返す', async () => {
        const result = await runPrepareCli(
            'case $1 in\n  image) echo "No such image" >&2; exit 1 ;;\n  pull) echo "dial tcp: connection reset by peer" >&2; exit 1 ;;\n  *) exit 97 ;;\nesac',
        );
        expect(result.code).toBe(75);
        expect(result.stderr).toContain('deps-prepare: FETCH-FAILED dependency-images-fetch-failed pull node:');
        expect(result.stderr).toContain('connection reset by peer');
        expect(result.calls.filter(call => call.startsWith('pull '))).toHaveLength(FETCH_ATTEMPTS);
        expect(result.calls.some(call => call.startsWith('buildx '))).toBe(false);
    }, 30_000);

    it('[AR-10.9] 入力の誤りは取得の失敗ではなく 2 を返す', async () => {
        const root = await fixtureRoot();
        await writeFile(join(root, 'Dockerfile.debian'), 'FROM scratch\n');
        const out: string[] = [];
        const err: string[] = [];
        const code = await prepareCliMain({
            root,
            out: { write: (text: string) => void out.push(text) } as unknown as NodeJS.WritableStream,
            err: { write: (text: string) => void err.push(text) } as unknown as NodeJS.WritableStream,
        });
        expect(code).toBe(2);
        expect(err.join('')).toContain('deps-prepare: INVALID-INPUT base-digest-missing');
        expect(out.join('')).toBe('');
    });

    it('[AR-10.9] 想定外の失敗は 1 を返す', async () => {
        const root = await fixtureRoot();
        await rm(join(root, 'package.json'));
        const err: string[] = [];
        const code = await prepareCliMain({
            root,
            out: { write: () => true } as unknown as NodeJS.WritableStream,
            err: { write: (text: string) => void err.push(text) } as unknown as NodeJS.WritableStream,
        });
        expect(code).toBe(1);
        expect(err.join('')).toContain('deps-prepare: ERROR');
    });
});

/** inspect だけに答える fake。`present` にある ref は在る、`platform` はビルドした image の Os/Architecture。 */
function checkRun(present: Set<string>, options: { platform?: string; buildCode?: number } = {}) {
    const calls: string[][] = [];
    const run: Run = async argv => {
        calls.push(argv);
        if (argv[1] === 'image' && argv[2] === 'inspect') {
            const ref = argv[argv.length - 1];
            if (argv.includes('{{.Os}}/{{.Architecture}}')) {
                return { code: 0, stdout: `${options.platform ?? 'linux/amd64'}\n`, stderr: '' };
            }
            return present.has(ref)
                ? { code: 0, stdout: `${IMAGE_ID}\n`, stderr: '' }
                : { code: 1, stdout: '', stderr: 'No such image' };
        }
        if (argv[1] === 'build') {
            return { code: options.buildCode ?? 0, stdout: '', stderr: options.buildCode ? 'boom' : '' };
        }
        return { code: 97, stdout: '', stderr: `unexpected: ${argv.join(' ')}` };
    };
    return { run, calls };
}

const FETCH_VERBS = ['pull', 'build', 'buildx', 'push', 'login', 'load', 'create', 'run'];

describe('確認の本体: 準備済みの確認', () => {
    it.each(['debian', 'alpine'])(
        '[AR-10.10] %s: base と npm の層が揃っていれば inspect だけで成功し、npm の層の tag を返す',
        async flavor => {
            const root = await fixtureRoot();
            const plan = planDependencyImages(root);
            const present = new Set(allImageRefs(root));
            const { run, calls } = checkRun(present);
            const tags = await verifyPrepared({ root, run, flavor });
            expect(tags).toEqual({
                client: plan.images.find(image => image.kind === `${flavor}-client` && image.layer === 'npm')!.tag,
                server: plan.images.find(image => image.kind === `${flavor}-server` && image.layer === 'npm')!.tag,
            });
            expect(calls.length).toBeGreaterThan(0);
            for (const argv of calls) {
                expect(argv.slice(0, 3)).toEqual(['docker', 'image', 'inspect']);
            }
        },
    );

    it('[AR-10.10] base は Dockerfile の digest で固定した ref で確かめる（tag だけの ref では確かめない）', async () => {
        const root = await fixtureRoot();
        const { run, calls } = checkRun(new Set(allImageRefs(root)));
        await verifyPrepared({ root, run, flavor: 'debian' });
        const inspected = calls.map(argv => argv[argv.length - 1]);
        for (const base of planDependencyImages(root).bases) {
            expect(inspected).toContain(base.ref);
            expect(inspected).not.toContain(base.tag);
        }
    });

    it.each(['debian', 'alpine'])(
        '[AR-10.10] %s: npm の層が無ければ not-prepared で、準備の command を示し、取得の argv は 0 件',
        async flavor => {
            const root = await fixtureRoot();
            const missing = tagsByKind(root)[`${flavor}-server/npm`];
            const present = new Set(allImageRefs(root));
            present.delete(missing);
            const { run, calls } = checkRun(present);
            const failure = await verifyPrepared({ root, run, flavor }).catch((error: unknown) => error);
            expect(failure).toBeInstanceOf(DockerImageCheckError);
            expect(failure).toMatchObject({ reason: 'not-prepared' });
            expect((failure as Error).message).toContain(missing);
            expect((failure as Error).message).toContain(PREPARE_COMMAND);
            expect(calls.filter(argv => FETCH_VERBS.includes(argv[1]))).toEqual([]);
        },
    );

    it('[AR-10.10] base が無い、または lock file の更新で現在の tag の層が無ければ、準備されていない', async () => {
        const root = await fixtureRoot();
        const present = new Set(allImageRefs(root));
        const base = planDependencyImages(root).bases[0].ref;
        present.delete(base);
        const baseFailure = await verifyPrepared({ root, run: checkRun(present).run, flavor: 'debian' }).catch(
            (error: unknown) => error,
        );
        expect(baseFailure).toMatchObject({ reason: 'not-prepared' });
        expect((baseFailure as Error).message).toContain(base);

        const stale = new Set(allImageRefs(root));
        await writeFile(join(root, 'package-lock.json'), '{"lock":"server-2"}\n');
        const { run, calls } = checkRun(stale);
        await expect(verifyPrepared({ root, run, flavor: 'debian' })).rejects.toMatchObject({ reason: 'not-prepared' });
        expect(calls.every(argv => argv[1] === 'image' && argv[2] === 'inspect')).toBe(true);
    });
});

describe('確認の本体: 製品の Dockerfile から導いた Dockerfile', () => {
    it.each(['debian', 'alpine'])(
        '[AR-10.2] %s: 各 builder stage の依存の部分が npm の層の tag の FROM 1 行になり、それ以外の行は製品のまま',
        async flavor => {
            const root = await fixtureRoot();
            const plan = planDependencyImages(root);
            const product = (await readFile(join(root, `Dockerfile.${flavor}`), 'utf8')).split('\n');
            const derived = deriveImageDockerfile({ root, flavor }).split('\n');

            const stages = plan.stages.filter(stage => stage.flavor === flavor);
            expect(stages.map(stage => stage.stage)).toEqual(['client-builder', 'server-builder']);
            const expected: string[] = [];
            let cursor = 0;
            for (const stage of stages) {
                expected.push(...product.slice(cursor, stage.from), `FROM ${stage.npmTag} AS ${stage.stage}`);
                cursor = stage.copy;
            }
            expected.push(...product.slice(cursor));
            expect(derived).toEqual(expected);

            // FROM が準備済みの npm の層の tag になった stage の後は、製品の行（COPY . 以降）がそのまま続く。
            for (const stage of stages) {
                const at = derived.indexOf(`FROM ${stage.npmTag} AS ${stage.stage}`);
                expect(at, stage.stage).toBeGreaterThanOrEqual(0);
                expect(derived[at + 1].startsWith('COPY . '), stage.stage).toBe(true);
                expect(derived[at + 1]).toBe(product[stage.copy]);
            }
            // 外から取る FROM は最終 stage の base だけ。依存を入れる行は残らない。
            const text = derived.join('\n');
            expect(text).not.toMatch(/npm ci|apt-get|apk add|pip install/u);
            expect(text).toContain('RUN npm run compile');
            expect(text).toContain('RUN npm run bundle');
            expect(text).toContain('RUN rm -rf client');
            const productLastFrom = product.filter(line => line.startsWith('FROM ')).pop()!;
            expect([...text.matchAll(/^FROM (\S+)/gmu)].map(match => match[1])).toEqual([
                stages[0].npmTag,
                stages[1].npmTag,
                /^FROM (\S+)/u.exec(productLastFrom)![1],
            ]);
        },
    );

    it('[AR-10.2] 実リポジトリの Dockerfile からも、両方の flavor で導ける', () => {
        for (const flavor of ['debian', 'alpine']) {
            const derived = deriveImageDockerfile({ root: repositoryRoot, flavor });
            const product = readFileSync(join(repositoryRoot, `Dockerfile.${flavor}`), 'utf8');
            expect(derived.length).toBeLessThan(product.length);
            expect(derived.split('\n').filter(line => line.startsWith('FROM ')).length).toBe(
                product.split('\n').filter(line => line.startsWith('FROM ')).length,
            );
        }
    });

    it('[AR-10.2] 導いた Dockerfile は test/server/.artifacts/docker-image-check/<id>/Dockerfile に置く', async () => {
        const root = await fixtureRoot();
        const path = writeImageDockerfile({ root, flavor: 'debian', id: 'run-1' });
        expect(path).toBe(join(root, 'test', 'server', '.artifacts', 'docker-image-check', 'run-1', 'Dockerfile'));
        expect(readFileSync(path, 'utf8')).toBe(deriveImageDockerfile({ root, flavor: 'debian' }));
    });

    it('[AR-10.2] 不正な id と flavor は拒む', async () => {
        const root = await fixtureRoot();
        expect(() => writeImageDockerfile({ root, flavor: 'debian', id: '../x' })).toThrow('invalid check id');
        expect(() => deriveImageDockerfile({ root, flavor: 'fedora' })).toThrow('unknown flavor');
    });
});

describe('確認の本体: image の構築', () => {
    it('[AR-10.1][AR-10.2] --platform linux/amd64 --network=none --pull=false --no-cache で構築し、Os・Architecture を確かめ、argv を ledger に残す', async () => {
        const root = await fixtureRoot();
        const { run, ledger } = createDockerLedger(checkRun(new Set()).run);
        const image = await buildCheckImage({
            root,
            run,
            flavor: 'alpine',
            id: 'run-1',
            dockerfilePath: '<dockerfile>',
        });
        expect(image).toBe('epgstation-docker-check-alpine:run-1');
        expect(image).toBe(checkImageName('alpine', 'run-1'));
        expect(ledger).toEqual([
            [
                'docker',
                'build',
                '--platform',
                'linux/amd64',
                '--network=none',
                '--pull=false',
                '--no-cache',
                '-f',
                '<dockerfile>',
                '-t',
                image,
                '--label',
                'epgstation.docker-check.owner=run-1',
                root,
            ],
            ['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', image],
        ]);
    });

    it('[AR-10.1] 構築の上限時間を build に渡す', async () => {
        const seen: Array<number | undefined> = [];
        const inner = checkRun(new Set()).run;
        const run: Run = (argv, options) => {
            if (argv[1] === 'build') {
                seen.push(options?.timeoutMs);
            }
            return inner(argv, options);
        };
        await buildCheckImage({ root: '<context>', run, flavor: 'debian', id: 'a', dockerfilePath: '<dockerfile>' });
        expect(seen).toEqual([BUILD_TIMEOUT_MS]);
    });

    it('[AR-10.1] 構築の上限時間は準備の build の上限と同じ定数から決まる', () => {
        expect(BUILD_TIMEOUT_MS).toBe(FETCH_TIMEOUT_MS.osBuild);
    });

    it('[AR-10.1] 構築の失敗は build-failed で、stderr を含む', async () => {
        const { run } = checkRun(new Set(), { buildCode: 1 });
        const failure = await buildCheckImage({
            root: '<context>',
            run,
            flavor: 'debian',
            id: 'a',
            dockerfilePath: '<dockerfile>',
        }).catch((error: unknown) => error);
        expect(failure).toMatchObject({ name: 'DockerImageCheckError', reason: 'build-failed' });
        expect((failure as Error).message).toContain('boom');
    });

    it('[AR-10.1] linux/amd64 でない image は build-failed にする', async () => {
        const { run } = checkRun(new Set(), { platform: 'linux/arm64' });
        await expect(
            buildCheckImage({ root: '<context>', run, flavor: 'debian', id: 'a', dockerfilePath: '<dockerfile>' }),
        ).rejects.toMatchObject({ reason: 'build-failed' });
    });
});

interface Scenario {
    buildCode?: number;
    /** server container が起動直後に終了している。 */
    serverExits?: boolean;
    /** server が応答しない（deadline まで接続できない）。 */
    silent?: boolean;
    version?: string;
    indexType?: string;
    indexStatus?: number;
    /** `docker rm -f` が container を消さない。 */
    stuckContainer?: boolean;
}

/** docker の状態（container・network・image）を持つ fake。label の付いた資源を `ps`・`ls`・`images` で列挙できる。 */
function statefulDocker(root: string, scenario: Scenario = {}) {
    const present = new Set(allImageRefs(root));
    const containers = new Map<string, { running: boolean; args: string[] }>();
    const networks = new Set<string>();
    const images = new Set<string>();
    const calls: string[][] = [];
    const run: Run = async argv => {
        calls.push(argv);
        const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
        const verb = argv[1];
        if (verb === 'image' && argv[2] === 'inspect') {
            const ref = argv[argv.length - 1];
            if (argv.includes('{{.Os}}/{{.Architecture}}')) {
                return ok('linux/amd64\n');
            }
            return present.has(ref) || images.has(ref)
                ? ok(`${IMAGE_ID}\n`)
                : { code: 1, stdout: '', stderr: 'No such image' };
        }
        if (verb === 'build') {
            if (scenario.buildCode) {
                return { code: scenario.buildCode, stdout: '', stderr: 'boom' };
            }
            images.add(argv[argv.indexOf('-t') + 1]);
            return ok();
        }
        if (verb === 'network' && argv[2] === 'create') {
            networks.add(argv[argv.length - 1]);
            return ok();
        }
        if (verb === 'run') {
            const name = argv[argv.indexOf('--name') + 1];
            containers.set(name, {
                running: !(scenario.serverExits && !name.includes('-stub-')),
                args: argv,
            });
            return ok(`${name}\n`);
        }
        if (verb === 'inspect' && argv.includes('{{.State.Running}}')) {
            const container = containers.get(argv[argv.length - 1]);
            return container ? ok(`${container.running}\n`) : { code: 1, stdout: '', stderr: 'No such' };
        }
        if (verb === 'inspect') {
            const container = containers.get(argv[argv.length - 1])!;
            const network = container.args[container.args.indexOf('--network') + 1];
            return ok(
                JSON.stringify({ NetworkSettings: { Networks: { [network]: {} } }, HostConfig: { PortBindings: {} } }),
            );
        }
        if (verb === 'exec') {
            if (scenario.silent) {
                return { code: 3, stdout: '', stderr: '' };
            }
            const script = argv[argv.length - 1];
            if (script.includes('8888/api/version')) {
                return ok(
                    JSON.stringify({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ version: scenario.version ?? '9.9.9' }),
                    }),
                );
            }
            if (script.includes('devPackagesPresent')) {
                return ok(
                    JSON.stringify({
                        devPackagesPresent: [],
                        runtimePackagePresent: true,
                        clientNodeModulesPresent: false,
                        clientBundlePresent: true,
                    }),
                );
            }
            return ok(
                JSON.stringify({
                    status: scenario.indexStatus ?? 200,
                    contentType: scenario.indexType ?? 'text/html; charset=UTF-8',
                    body: '<html>',
                }),
            );
        }
        if (verb === 'logs') {
            return ok(`log of ${argv[argv.length - 1]}\n`);
        }
        if (verb === 'ps') {
            return ok([...containers.keys()].map(name => `${name}\n`).join(''));
        }
        if (verb === 'network' && argv[2] === 'ls') {
            return ok([...networks].map(name => `${name}\n`).join(''));
        }
        if (verb === 'images') {
            return ok([...images].map(name => `${name}\n`).join(''));
        }
        if (verb === 'rm') {
            if (!scenario.stuckContainer) {
                containers.delete(argv[argv.length - 1]);
            }
            return ok();
        }
        if (verb === 'network' && argv[2] === 'rm') {
            networks.delete(argv[argv.length - 1]);
            return ok();
        }
        if (verb === 'rmi') {
            images.delete(argv[argv.length - 1]);
            return ok();
        }
        return { code: 97, stdout: '', stderr: `unexpected: ${argv.join(' ')}` };
    };
    return { run, calls, containers, networks, images, present };
}

async function checkRoot(): Promise<string> {
    const root = await fixtureRoot();
    await cp(join(repositoryRoot, 'config'), join(root, 'config'), { recursive: true });
    // image の中身の確認が代表の package（開発用と実行用）を package.json から読むので、それらを載せる。
    await writeFile(
        join(root, 'package.json'),
        `${JSON.stringify({
            name: 'server',
            version: '9.9.9',
            dependencies: { [RUNTIME_PACKAGE_SAMPLE]: '0.0.0' },
            devDependencies: Object.fromEntries(DEV_PACKAGE_SAMPLES.map(name => [name, '0.0.0'])),
        })}\n`,
    );
    return root;
}

const noWait = { sleep: async () => undefined };

describe('確認の本体: tuner server の代役と起動・応答の確認・片付け', () => {
    it.each(['debian', 'alpine'])(
        '[AR-10.3][AR-10.4] %s: 代役と server を専用の network に起動し、設定の mirakurunPath を代役の container 名にし、host の port を公開しない',
        async flavor => {
            const root = await checkRoot();
            const docker = statefulDocker(root);
            const facts = await runImageCheck({
                root,
                run: docker.run,
                flavor,
                id: 'c1',
                probeDeadlineMs: 5000,
                ...noWait,
            });
            const names = checkResourceNames(flavor, 'c1');
            expect(facts.names).toEqual(names);
            const target = new URL(facts.mirakurunPath);
            expect([target.protocol, target.hostname, target.port, target.pathname]).toEqual([
                'http:',
                names.stub,
                String(STUB_PORT),
                '/',
            ]);
            expect(facts.networks).toEqual([names.network]);
            expect(facts.publishedPorts).toEqual([]);
            expect(facts.expectedVersion).toBe('9.9.9');
            const config = await readFile(
                join(root, 'test', 'server', '.artifacts', 'docker-image-check', 'c1', 'config', 'config.yml'),
                'utf8',
            );
            expect(config).toContain(`mirakurunPath: ${facts.mirakurunPath}`);
            expect(config.match(/^mirakurunPath:/gmu)).toHaveLength(1);
            const runs = docker.calls.filter(argv => argv[1] === 'run');
            for (const argv of runs) {
                expect(argv).not.toContain('-p');
                expect(argv).not.toContain('--publish');
                expect(argv).not.toContain('-P');
                expect(argv).toContain(names.network);
            }
            const server = runs.find(argv => argv.includes(names.server))!;
            expect(server).not.toContain('--entrypoint');
            for (const name of [
                'config.yml',
                'serviceLogConfig.yml',
                'operatorLogConfig.yml',
                'epgUpdaterLogConfig.yml',
            ]) {
                expect(server.some(token => token.endsWith(`:/app/config/${name}:ro`))).toBe(true);
            }
            const stub = runs.find(argv => argv.includes(names.stub))!;
            expect(stub.slice(stub.indexOf('--entrypoint'))).toEqual(['--entrypoint', 'node', names.image, '/stub.js']);
        },
    );

    it.each(['debian', 'alpine'])(
        '[AR-10.12] %s: 成功したあと、この run の container・network・検査用 image は残らず、依存 image は残る',
        async flavor => {
            const root = await checkRoot();
            const docker = statefulDocker(root);
            const before = new Set(docker.present);
            await runImageCheck({ root, run: docker.run, flavor, id: 'c2', probeDeadlineMs: 5000, ...noWait });
            expect(docker.containers.size).toBe(0);
            expect(docker.networks.size).toBe(0);
            expect(docker.images.size).toBe(0);
            expect(docker.present).toEqual(before);
            expect(
                docker.calls.filter(argv => argv[1] === 'rmi').every(argv => !before.has(argv[argv.length - 1])),
            ).toBe(true);
            assertNoRegistryAccess(docker.calls);
        },
    );

    it('[AR-10.3] deadline までに応答しなければ start-failed で、server と stub の logs を message に含み、片付ける', async () => {
        const root = await checkRoot();
        const docker = statefulDocker(root, { silent: true });
        let clock = 0;
        const failure = await runImageCheck({
            root,
            run: docker.run,
            flavor: 'debian',
            id: 'c3',
            probeDeadlineMs: 3000,
            sleep: async ms => void (clock += ms),
            now: () => clock,
        }).catch((error: unknown) => error);
        expect(failure).toMatchObject({ name: 'DockerImageCheckError', reason: 'start-failed' });
        const names = checkResourceNames('debian', 'c3');
        expect((failure as Error).message).toContain(`log of ${names.server}`);
        expect((failure as Error).message).toContain(`log of ${names.stub}`);
        expect(docker.calls.filter(argv => argv[1] === 'logs').every(argv => argv.includes('--tail'))).toBe(true);
        expect(docker.containers.size + docker.networks.size + docker.images.size).toBe(0);
    });

    it('[AR-10.3] container が終了していれば deadline を待たずに start-failed にし、片付ける', async () => {
        const root = await checkRoot();
        const docker = statefulDocker(root, { serverExits: true });
        const slept: number[] = [];
        const failure = await runImageCheck({
            root,
            run: docker.run,
            flavor: 'alpine',
            id: 'c4',
            probeDeadlineMs: 600_000,
            sleep: async ms => void slept.push(ms),
        }).catch((error: unknown) => error);
        expect(failure).toMatchObject({ reason: 'start-failed' });
        expect((failure as Error).message).toContain('is not running');
        expect(slept).toEqual([]);
        expect(docker.calls.some(argv => argv[1] === 'exec')).toBe(false);
        expect(docker.containers.size + docker.networks.size + docker.images.size).toBe(0);
    });

    it.each([
        ['version が package.json と違う', { version: '0.0.1' }, '/api/version'],
        ['/ が HTML でない', { indexType: 'application/json' }, 'GET /'],
        ['/ が 200 でない', { indexStatus: 404 }, 'GET /'],
    ] as [string, Scenario, string][])(
        '[AR-10.3] %s と response-invalid にし、片付ける',
        async (_label, scenario, text) => {
            const root = await checkRoot();
            const docker = statefulDocker(root, scenario);
            const failure = await runImageCheck({
                root,
                run: docker.run,
                flavor: 'debian',
                id: 'c5',
                probeDeadlineMs: 5000,
                ...noWait,
            }).catch((error: unknown) => error);
            expect(failure).toMatchObject({ reason: 'response-invalid' });
            expect((failure as Error).message).toContain(text);
            expect((failure as Error).message).toContain('log of');
            expect(docker.containers.size + docker.networks.size + docker.images.size).toBe(0);
        },
    );

    it('[AR-10.12] 準備されていなければ not-prepared、構築の失敗は build-failed で、どちらも container を作らず、取得もしない', async () => {
        const root = await checkRoot();
        const unprepared = statefulDocker(root);
        unprepared.present.clear();
        await expect(
            runImageCheck({ root, run: unprepared.run, flavor: 'debian', id: 'c6', probeDeadlineMs: 5000, ...noWait }),
        ).rejects.toMatchObject({ reason: 'not-prepared' });
        expect(unprepared.calls.some(argv => ['build', 'run', 'pull'].includes(argv[1]))).toBe(false);

        const broken = statefulDocker(root, { buildCode: 1 });
        await expect(
            runImageCheck({ root, run: broken.run, flavor: 'alpine', id: 'c7', probeDeadlineMs: 5000, ...noWait }),
        ).rejects.toMatchObject({ reason: 'build-failed' });
        expect(broken.calls.some(argv => argv[1] === 'run')).toBe(false);
        expect(broken.images.size).toBe(0);
        // 失敗した確認でも片付けの列挙は呼ぶ。
        expect(broken.calls.some(argv => argv[1] === 'ps')).toBe(true);
    });

    it('[AR-10.12] 片付けても資源が残れば cleanup-failed にし、先に起きた失敗の message を添える', async () => {
        const root = await checkRoot();
        const stuck = statefulDocker(root, { stuckContainer: true });
        const failure = await runImageCheck({
            root,
            run: stuck.run,
            flavor: 'debian',
            id: 'c8',
            probeDeadlineMs: 5000,
            ...noWait,
        }).catch((error: unknown) => error);
        expect(failure).toMatchObject({ reason: 'cleanup-failed' });
        expect((failure as Error).message).toContain('containers:');

        const brokenAndStuck = statefulDocker(root, { silent: true, stuckContainer: true });
        let clock = 0;
        const both = await runImageCheck({
            root,
            run: brokenAndStuck.run,
            flavor: 'debian',
            id: 'c9',
            probeDeadlineMs: 1000,
            sleep: async ms => void (clock += ms),
            now: () => clock,
        }).catch((error: unknown) => error);
        expect(both).toMatchObject({ reason: 'cleanup-failed' });
        expect((both as Error).message).toContain('earlier failure');
        expect((both as Error).message).toContain('did not answer');
    });

    it('[AR-10.12] 片付けは label の付いた資源だけを対象にし、依存 image を消さない', async () => {
        const run: Run = async argv => {
            seen.push(argv);
            return { code: 0, stdout: '', stderr: '' };
        };
        const seen: string[][] = [];
        await cleanupResources({ run, id: 'c10' });
        const listings = seen.filter(argv => ['ps', 'ls', 'images'].includes(argv[1]) || argv[2] === 'ls');
        expect(listings.length).toBeGreaterThan(0);
        for (const argv of listings) {
            expect(argv).toContain('label=epgstation.docker-check.owner=c10');
        }
        expect(seen.filter(argv => ['rm', 'rmi'].includes(argv[1]))).toEqual([]);
    });

    it('[AR-10.11] push・login・--push・registry への --output があれば registry-access、build の --output=type=local は許す', () => {
        expect(() => assertNoRegistryAccess([['docker', 'build', '--network=none', '-t', 'x', '.']])).not.toThrow();
        expect(() =>
            assertNoRegistryAccess([['docker', 'build', '--output', 'type=local,dest=out', '.']]),
        ).not.toThrow();
        for (const argv of [
            ['docker', 'push', 'x'],
            ['docker', 'login', 'registry'],
            ['docker', 'build', '--push', '.'],
            ['docker', 'build', '--output', 'type=registry,ref=x', '.'],
            ['docker', 'buildx', 'build', '--output=type=image,push=true', '.'],
            ['docker', 'build', '-o', 'type=registry', '.'],
        ]) {
            expect(() => assertNoRegistryAccess([['docker', 'ps'], argv]), argv.join(' ')).toThrowError(
                /registry-access/u,
            );
        }
    });

    it('[AR-10.3][AR-10.12] 確認の失敗は、構築・起動・応答・片付けの理由（build-failed・start-failed・response-invalid・cleanup-failed）で互いに区別できる', async () => {
        const reasons = new Set<string>();
        const root = await checkRoot();
        const scenarios: [Scenario, string][] = [
            [{ buildCode: 1 }, 'build-failed'],
            [{ serverExits: true }, 'start-failed'],
            [{ version: '0' }, 'response-invalid'],
            [{ stuckContainer: true, serverExits: true }, 'cleanup-failed'],
        ];
        for (const [scenario, reason] of scenarios) {
            const docker = statefulDocker(root, scenario);
            const failure = (await runImageCheck({
                root,
                run: docker.run,
                flavor: 'debian',
                id: 'c11',
                probeDeadlineMs: 5000,
                ...noWait,
            }).catch((error: unknown) => error)) as DockerImageCheckError;
            expect(failure.reason).toBe(reason);
            reasons.add(failure.reason);
        }
        expect(reasons.size).toBe(scenarios.length);
    });

    it('[AR-10.3] probeHttp は応答が出るまで 1 秒間隔で試し、応答までの時間を返す', async () => {
        const names = checkResourceNames('debian', 'c12');
        let attempts = 0;
        let clock = 0;
        const run: Run = async argv => {
            if (argv[1] === 'inspect') {
                return { code: 0, stdout: 'true\n', stderr: '' };
            }
            const script = argv[argv.length - 1];
            if (script.includes('8888/api/version')) {
                attempts += 1;
                return attempts < 3
                    ? { code: 3, stdout: '', stderr: '' }
                    : {
                          code: 0,
                          stdout: JSON.stringify({ status: 200, contentType: 'x', body: '{"version":"1.2.3"}' }),
                          stderr: '',
                      };
            }
            return { code: 0, stdout: JSON.stringify({ status: 200, contentType: 'text/html', body: '' }), stderr: '' };
        };
        const slept: number[] = [];
        const elapsed = await probeHttp({
            run,
            names,
            expectedVersion: '1.2.3',
            deadlineMs: 10_000,
            sleep: async ms => void ((clock += ms), slept.push(ms)),
            now: () => clock,
        });
        expect(slept).toEqual([1000, 1000]);
        expect(elapsed).toBe(2000);
    });
});
