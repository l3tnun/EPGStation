import 'reflect-metadata';

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PublicConfigModel {
    getConfig(isSecure: boolean): Promise<Record<string, unknown>>;
}

interface PublicConfigModelConstructor {
    new (
        configuration: { getConfig(): Record<string, unknown> },
        ipc: { reserveation: { getBroadcastStatus(): Promise<Record<string, boolean>> } },
    ): PublicConfigModel;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}
const ConfigApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'config', 'ConfigApiModel.js')) as {
        default: PublicConfigModelConstructor;
    }
).default;

const loopbackHost = '127.0.0.1';

const loopbackRequestUrl = (port: number, path: string): string =>
    ['http:', '', `${loopbackHost}:${port}${path}`].join('/');

const privateSourceConfig = (): Record<string, unknown> => ({
    port: 48100,
    socketioPort: 48101,
    clientSocketioPort: 48999,
    https: {
        port: 48443,
        socketioPort: 48444,
        key: 'synthetic-private-key-marker',
        cert: 'synthetic-certificate-marker',
    },
    recorded: [{ name: 'archive', path: 'synthetic-internal-path-marker/archive' }],
    encode: [{ name: 'mobile', cmd: 'external-command-marker' }],
    urlscheme: {
        m2ts: { ios: 'm2ts-ios', android: 'm2ts-android', mac: 'm2ts-mac', win: 'm2ts-win' },
        video: { ios: 'video-ios', android: 'video-android', mac: 'video-mac', win: 'video-win' },
        download: { ios: 'download-ios', android: 'download-android', mac: 'download-mac', win: 'download-win' },
    },
    stream: {
        live: { ts: { m2ts: [{ name: 'direct' }], hls: [{ name: 'live-hls', cmd: 'command-marker' }] } },
        recorded: {
            ts: { mp4: [{ name: 'recorded-mp4', cmd: 'command-marker' }] },
            encoded: { hls: [{ name: 'encoded-hls', cmd: 'command-marker' }] },
        },
    },
    kodiHosts: [{ name: 'living-room', host: 'internal-host-marker', password: 'synthetic-auth-secret-marker' }],
    mysql: { user: 'synthetic-database-user-marker', password: 'synthetic-database-secret-marker' },
    streamFilePath: 'synthetic-internal-path-marker/stream',
    thumbnailCmd: 'external-command-marker',
    encodeQueueLimit: 'encode-queue-limit-marker',
    concurrentUploadNum: 'concurrent-upload-marker',
    uploadReceiveTimeoutMs: 'upload-timeout-marker',
    thumbnailMaxPending: 'thumbnail-limit-marker',
    hookCommandMaxPending: 'hook-limit-marker',
    hookCommandTimeoutMs: 'hook-timeout-marker',
    storageLimitCommandTimeoutMs: { marker: 'storage-timeout-carrier-marker' },
    unknownPrivateSetting: 'unknown-private-marker',
});

const expectedPublicConfig = {
    socketIOPort: 48999,
    recorded: ['archive'],
    encode: ['mobile'],
    urlscheme: {
        m2ts: { ios: 'm2ts-ios', android: 'm2ts-android', mac: 'm2ts-mac', win: 'm2ts-win' },
        video: { ios: 'video-ios', android: 'video-android', mac: 'video-mac', win: 'video-win' },
        download: { ios: 'download-ios', android: 'download-android', mac: 'download-mac', win: 'download-win' },
    },
    broadcast: { GR: true, BS: false, CS: true, SKY: false },
    isEnableTSLiveStream: true,
    isEnableTSRecordedStream: true,
    isEnableEncodedRecordedStream: true,
    streamConfig: {
        live: {
            ts: {
                m2ts: [{ name: 'direct', isUnconverted: true }],
                hls: ['live-hls'],
            },
        },
        recorded: {
            ts: { mp4: ['recorded-mp4'] },
            encoded: { hls: ['encoded-hls'] },
        },
    },
    kodiHosts: ['living-room'],
};

describe('configuration public HTTP projection boundary', () => {
    it('[CFG-3.1-HTTP-ALLOWLIST] returns the exact allowlist for plain and secure requests without private markers', async () => {
        const sourceConfig = privateSourceConfig();
        const model = new ConfigApiModel(
            { getConfig: () => JSON.parse(JSON.stringify(sourceConfig)) as Record<string, unknown> },
            {
                reserveation: {
                    getBroadcastStatus: async () => ({ GR: true, BS: false, CS: true, SKY: false }),
                },
            },
        );
        const requestedPaths: string[] = [];
        const server = createServer(async (request, response) => {
            const path = request.url ?? '/';
            requestedPaths.push(path);
            try {
                const result = await model.getConfig(path === '/secure');
                response.statusCode = 200;
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify(result));
            } catch (error) {
                response.statusCode = 500;
                response.end(String(error));
            }
        });

        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, loopbackHost, () => {
                    server.off('error', reject);
                    resolve();
                });
            });
            const address = server.address();
            if (address === null || typeof address === 'string') {
                throw new Error('Loopback server did not expose a TCP port');
            }

            for (const path of ['/plain', '/secure']) {
                const response = await fetch(loopbackRequestUrl(address.port, path));
                expect(response.status).toBe(200);
                const body = (await response.json()) as Record<string, unknown>;
                expect(body).toEqual(expectedPublicConfig);
                for (const internalField of [
                    'encodeQueueLimit',
                    'concurrentUploadNum',
                    'uploadReceiveTimeoutMs',
                    'thumbnailMaxPending',
                    'hookCommandMaxPending',
                    'hookCommandTimeoutMs',
                    'storageLimitCommandTimeoutMs',
                ]) {
                    expect(body).not.toHaveProperty(internalField);
                }

                const serialized = JSON.stringify(body);
                for (const marker of [
                    'private-key-marker',
                    'certificate-marker',
                    'internal-path-marker',
                    'external-command-marker',
                    'command-marker',
                    'internal-host-marker',
                    'auth-secret-marker',
                    'database-user-marker',
                    'database-secret-marker',
                    'encode-queue-limit-marker',
                    'concurrent-upload-marker',
                    'upload-timeout-marker',
                    'thumbnail-limit-marker',
                    'hook-limit-marker',
                    'hook-timeout-marker',
                    'storage-timeout-carrier-marker',
                    'unknown-private-marker',
                ]) {
                    expect(serialized).not.toContain(marker);
                }
            }

            expect(requestedPaths).toEqual(['/plain', '/secure']);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close(error => (error === undefined ? resolve() : reject(error)));
            });
        }

        expect(server.listening).toBe(false);
    });
});
