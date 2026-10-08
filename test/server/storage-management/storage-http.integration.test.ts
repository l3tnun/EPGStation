import 'reflect-metadata';

import { createServer, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface StorageInformationRuntime {
    getDiskInfo(path: string): Promise<{ available: number; total: number; used: number }>;
    getInfo(): Promise<Record<string, unknown>>;
}

interface StorageInformationConstructor {
    new (configuration: { getConfig(): Record<string, unknown> }): StorageInformationRuntime;
}

interface StorageContainer {
    bind(identifier: string): { toConstantValue(value: unknown): void };
    isBound(identifier: string): boolean;
    unbind(identifier: string): void;
}

type StorageRoute = (request: unknown, response: unknown) => Promise<void>;

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const StorageApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'storage', 'StorageApiModel.js')) as {
        default: StorageInformationConstructor;
    }
).default;
const container = (require(join(compiledSnapshot, 'model', 'ModelContainer.js')) as { default: StorageContainer })
    .default;
const storageGet = (require(join(compiledSnapshot, 'model', 'service', 'api', 'storages.js')) as { get: StorageRoute })
    .get;

const loopbackHost = '127.0.0.1';
const requestUrl = (port: number): string => ['http:', '', `${loopbackHost}:${port}`, 'api', 'storages'].join('/');
const privateStorageControlFields = ['entryId', 'timeout', 'candidate', 'deletionResult'];

const expectPublicStorageBody = (body: unknown): void => {
    const serialized = JSON.stringify(body);
    for (const privateField of privateStorageControlFields) {
        expect(serialized).not.toContain(privateField);
    }
};

const bindStorageModel = (model: StorageInformationRuntime): void => {
    if (container.isBound('IStorageApiModel')) {
        container.unbind('IStorageApiModel');
    }
    container.bind('IStorageApiModel').toConstantValue(model);
};

const requestStorageRoute = async (): Promise<{ body: unknown; method: string | undefined; status: number }> => {
    let method: string | undefined;
    const server = createServer(async (request, response) => {
        method = request.method;
        if (request.method !== 'GET' || request.url !== '/api/storages') {
            response.statusCode = 404;
            response.end();
            return;
        }
        await storageGet(request, expressLikeResponse(response));
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, loopbackHost, () => resolve());
        });
        const address = server.address();
        if (address === null || typeof address === 'string') {
            throw new Error('Synthetic loopback listener did not expose a port');
        }
        const response = await fetch(requestUrl(address.port));
        return { body: await response.json(), method, status: response.status };
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
            server.close(error => (error === undefined ? resolve() : reject(error)));
        });
        expect(server.listening).toBe(false);
    }
};

const expressLikeResponse = (response: ServerResponse): Record<string, unknown> => {
    const adapter = {
        header(name: string, value: string) {
            response.setHeader(name, value);
            return adapter;
        },
        json(body: unknown) {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(body));
            return adapter;
        },
        status(code: number) {
            response.statusCode = code;
            return adapter;
        },
    };
    return adapter;
};

afterEach(() => {
    if (container.isBound('IStorageApiModel')) {
        container.unbind('IStorageApiModel');
    }
});

describe('GET /api/storages characterization: public storage list and read failure', () => {
    it('[SM-1.2-HTTP][SM-1.6-HTTP] returns the existing 200 items wire in configured order', async () => {
        const entries = [
            { name: 'first', path: 'synthetic-storage/shared' },
            { name: 'second', path: 'synthetic-storage/shared', limitThreshold: 99 },
        ];
        const model = new StorageApiModel({ getConfig: () => ({ recorded: entries }) });
        let readIndex = 0;
        model.getDiskInfo = async () => {
            readIndex += 1;
            return { available: readIndex, total: readIndex * 4, used: readIndex * 3 };
        };
        bindStorageModel(model);

        const response = await requestStorageRoute();

        expect(response).toEqual({
            body: {
                items: [
                    { available: 1, name: 'first', total: 4, used: 3 },
                    { available: 2, name: 'second', total: 8, used: 6 },
                ],
            },
            method: 'GET',
            status: 200,
        });
        const items = (response.body as { items: Array<Record<string, unknown>> }).items;
        expect(items.map(item => Object.keys(item).sort())).toEqual([
            ['available', 'name', 'total', 'used'],
            ['available', 'name', 'total', 'used'],
        ]);
        expectPublicStorageBody(response.body);
    });

    it('[SM-1.5-HTTP] maps a capacity failure to the existing 500 carrier without partial or internal fields', async () => {
        const model = new StorageApiModel({
            getConfig: () => ({
                recorded: [
                    { name: 'before', path: 'synthetic-storage/before' },
                    { name: 'failure', path: 'synthetic-storage/failure', limitCmd: 'private-command-marker' },
                ],
            }),
        });
        let reads = 0;
        model.getDiskInfo = async () => {
            reads += 1;
            if (reads === 2) {
                throw new Error('synthetic capacity failure');
            }
            return { available: 1, total: 2, used: 1 };
        };
        bindStorageModel(model);

        const response = await requestStorageRoute();

        expect(response).toEqual({
            body: {
                code: 500,
                errors: 'synthetic capacity failure',
                message: 'Internal Server Error',
            },
            method: 'GET',
            status: 500,
        });
        const serialized = JSON.stringify(response.body);
        for (const internalMarker of ['items', 'limitThreshold', 'limitCmd', 'operationId', 'private-command-marker']) {
            expect(serialized).not.toContain(internalMarker);
        }
        expectPublicStorageBody(response.body);
    });
});
