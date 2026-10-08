import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    IMAGE_CHECK_TEST_TIMEOUT_MS,
    INSPECT_TIMEOUT_MS,
    OWNER_LABEL,
    PROBE_DEADLINE_MS,
    STUB_PORT,
    assertNoRegistryAccess,
    createDockerLedger,
    runImageCheck,
    spawnRun,
    verifyPrepared,
} from '../../../scripts/server-test/docker-image-check.mjs';

const repositoryRoot = new URL('../../../', import.meta.url).pathname.replace(/\/$/u, '');

async function listByLabel(run: typeof spawnRun, id: string): Promise<string[]> {
    const filter = `label=${OWNER_LABEL}=${id}`;
    const listings = [
        ['docker', 'ps', '-a', '-q', '--filter', filter],
        ['docker', 'network', 'ls', '-q', '--filter', filter],
        ['docker', 'images', '-q', '--filter', filter],
    ];
    const found: string[] = [];
    for (const argv of listings) {
        const listed = await run(argv, { timeoutMs: INSPECT_TIMEOUT_MS });
        expect(listed.code, argv.join(' ')).toBe(0);
        found.push(...String(listed.stdout).split(/\s+/u).filter(Boolean));
    }
    return found;
}

describe.each(['debian', 'alpine'] as const)('公開用 Docker image（%s）の構築・起動・応答・片付け', flavor => {
    it(
        '準備済みの依存から image を構築して起動し、/api/version と / に応答し、片付けたあとに資源が残らない',
        async () => {
            const id = `${flavor}-${process.pid.toString(36)}-${Date.now().toString(36)}`;
            const { run, ledger } = createDockerLedger(spawnRun);
            const facts = await runImageCheck({
                root: repositoryRoot,
                run,
                flavor,
                id,
                probeDeadlineMs: PROBE_DEADLINE_MS,
            });

            // 10.3: /api/version の version は package.json と一致する（probe が確かめ済み）。
            const packageVersion = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).version;
            expect(facts.expectedVersion).toBe(packageVersion);

            // 10.4: 代役は専用の network 内だけにあり、server の設定は代役の container 名を指す。
            const target = new URL(facts.mirakurunPath);
            expect([target.protocol, target.hostname, target.port, target.pathname]).toEqual([
                'http:',
                facts.names.stub,
                String(STUB_PORT),
                '/',
            ]);
            expect(facts.networks).toEqual([facts.names.network]);
            expect(facts.publishedPorts).toEqual([]);
            const config = await readFile(
                join(repositoryRoot, 'test', 'server', '.artifacts', 'docker-image-check', id, 'config', 'config.yml'),
                'utf8',
            );
            expect(config).toContain(`mirakurunPath: ${facts.mirakurunPath}`);

            // 10.11: registry への公開をしていない。本体は外部から取得しない（pull・curl の argv が無い）。
            assertNoRegistryAccess(ledger);
            expect(ledger.some(argv => argv.includes('pull') || argv.includes('curl'))).toBe(false);
            const build = ledger.find(argv => argv[1] === 'build')!;
            expect(build).toContain('--network=none');
            expect(build).toContain('--pull=false');

            // 10.12: この run の container・network・検査用 image は残らず、依存 image は残っている。
            expect(await listByLabel(spawnRun, id)).toEqual([]);
            await expect(verifyPrepared({ root: repositoryRoot, run: spawnRun, flavor })).resolves.toBeDefined();
        },
        IMAGE_CHECK_TEST_TIMEOUT_MS,
    );
});
