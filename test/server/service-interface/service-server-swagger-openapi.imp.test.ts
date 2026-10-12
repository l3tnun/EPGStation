import express from 'express';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { close, compiled, listen } from './_harness';

/*
 * ServiceServer.js の `import * as fs from 'fs'` と `import openapi from 'express-openapi'` は静的に
 * 解決されるため、`vi.doMock` で import 元そのものを差し替えてから動的 import する。
 * fs は実体へ委譲し、`existsSync` だけを名前ごとに上書きできる Proxy にする。
 */
const actualFileSystem = createRequire(import.meta.url)('node:fs') as Record<string, any>;
const fsOverrides = new Map<string, (...args: any[]) => any>();
const fsProxy = new Proxy(actualFileSystem, {
    get(target, prop, receiver) {
        if (typeof prop === 'string' && fsOverrides.has(prop)) return fsOverrides.get(prop);
        return Reflect.get(target, prop, receiver);
    },
});
const openApiInitialize = vi.fn();

let ServiceServer: any;
let server: Server | undefined;

beforeAll(async () => {
    vi.doMock('fs', () => fsProxy);
    vi.doMock('node:fs', () => fsProxy);
    vi.doMock('express-openapi', () => ({
        default: { initialize: (...args: unknown[]) => openApiInitialize(...args) },
    }));
    try {
        vi.resetModules();
        ServiceServer = ((await import(compiled('model', 'service', 'ServiceServer.js'))) as any).default;
    } finally {
        vi.doUnmock('fs');
        vi.doUnmock('node:fs');
        vi.doUnmock('express-openapi');
    }
});

afterEach(async () => {
    fsOverrides.clear();
    openApiInitialize.mockReset();
    if (server !== undefined) {
        await close(server);
        server = undefined;
    }
});

afterAll(() => {
    vi.restoreAllMocks();
});

const makeService = (subDirectory: string | undefined) => {
    const service = Object.create(ServiceServer.prototype) as any;
    service.app = express();
    service.config = { subDirectory };
    service.log = { system: { error: vi.fn(), info: vi.fn() } };
    return service;
};

/**
 * ServiceServer の OpenAPI 検証 error の整形と、Swagger UI 配布物がある場合の公開 route。
 * 配布物の有無は `swagger-ui-dist` directory の存在で決まるため、存在判定だけを差し替える。
 */
describe('ServiceServer swagger and openapi wiring (unittest/imp)', () => {
    it('[SI-4.1] initOpenApi errorTransformer logs the validation error and exposes only its message', () => {
        const service = makeService(undefined);

        service.initOpenApi({ info: { title: 'synthetic' } });

        expect(openApiInitialize).toHaveBeenCalledOnce();
        const options = openApiInitialize.mock.calls[0][0] as { errorTransformer: (error: unknown) => unknown };
        const validationError = { errorCode: 'type.openapi.validation', message: 'must be integer', path: 'id' };

        expect(options.errorTransformer(validationError)).toEqual({ message: 'must be integer' });
        expect(service.log.system.error).toHaveBeenCalledExactlyOnceWith(validationError);
    });

    it.each([
        ['without subDirectory', undefined, '', '/api-docs/?url=/api/docs'],
        ['below subDirectory', '/epg', '/epg', '/epg/api-docs?url=/epg/api/docs'],
    ])(
        '[SI-1.7] setSwaggerUI serves the rewritten initializer and the debug redirect %s',
        async (_name, subDirectory, prefix, location) => {
            fsOverrides.set('existsSync', (target: unknown) => {
                if (String(target) === ServiceServer.SWAGGER_UI_DIST) return true;
                return actualFileSystem.existsSync(target);
            });
            const service = makeService(subDirectory);

            service.setSwaggerUI();
            server = service.app.listen(0, '127.0.0.1');
            const origin = await listen(server);

            const initializer = await fetch(`${origin}${prefix}/api-docs/swagger-initializer.js`);
            expect(initializer.status).toBe(200);
            const body = await initializer.text();
            expect(body).toContain(`${prefix}/api/docs`);
            expect(body).not.toContain('petstore');

            const redirect = await fetch(`${origin}${prefix}/api/debug`, { redirect: 'manual' });
            expect(redirect.status).toBe(302);
            expect(redirect.headers.get('location')).toBe(location);
        },
    );
});
