import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const ProductDetector = (require(join(compiledSnapshot, 'model', 'tuner', 'change', 'ProductDetector.js')) as any)
    .default;
const TunerHttpTransport = (
    require(join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;
const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;

type ProbeRouteHandler = (request: IncomingMessage, response: ServerResponse) => void;

const startProbeRedirectServer = async (
    finalHandler: ProbeRouteHandler,
): Promise<{ readonly close: () => Promise<void>; readonly port: number }> => {
    const server = createServer((request, response) => {
        if (request.url === '/api/config/server') {
            response.writeHead(302, { location: '/api/config/server/final' });
            response.end();
            return;
        }
        finalHandler(request, response);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Synthetic probe server did not bind');
    return {
        close: async () => {
            await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
        },
        port: address.port,
    };
};

afterEach(() => vi.restoreAllMocks());

describe('tuner product detection', () => {
    it.each([
        ['Mirakurun', { status: 200, body: {} }, 'mirakurun'],
        ['mirakc', { status: 404, body: 'synthetic ignored body' }, 'mirakc'],
    ])('[TA-2.3] caches only the final %s capability result', async (_label, result, product) => {
        const probe = vi.fn(async () => result);
        const detector = new ProductDetector(probe);

        await expect(detector.detect()).resolves.toBe(product);
        await expect(detector.detect()).resolves.toBe(product);

        expect(probe).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['201', async () => ({ status: 201, body: {} })],
        ['202', async () => ({ status: 202, body: {} })],
        ['redirect', async () => ({ status: 302, body: {} })],
        ['other client status', async () => ({ status: 400, body: {} })],
        ['server status', async () => ({ status: 503, body: {} })],
        ['null body', async () => ({ status: 200, body: null })],
        ['array body', async () => ({ status: 200, body: [] })],
        ['scalar body', async () => ({ status: 200, body: 'synthetic invalid scalar' })],
        [
            'network failure',
            async () => {
                throw new Error('SYNTHETIC_NETWORK_FAILURE');
            },
        ],
        [
            'timeout',
            async () => {
                throw new Error('SYNTHETIC_TIMEOUT');
            },
        ],
        [
            'parse failure',
            async () => {
                throw new Error('SYNTHETIC_PARSE_FAILURE');
            },
        ],
    ])('[TA-2.3] leaves %s retryable instead of caching a product', async (_label, outcome) => {
        const probe = vi.fn(outcome);
        const detector = new ProductDetector(probe);

        await expect(detector.detect()).rejects.toBeInstanceOf(Error);
        await expect(detector.detect()).rejects.toBeInstanceOf(Error);

        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('[TA-2.3] reports an owned stable error when a capability response is inconclusive', async () => {
        const detector = new ProductDetector(async () => ({ status: 201, body: {} }));

        await expect(detector.detect()).rejects.toThrow('Unable to detect tuner server product');
    });

    it('[TA-2.3] keeps concurrent caller cancellation local to its own capability probe', async () => {
        const cancelledController = new AbortController();
        const survivingController = new AbortController();
        const cancellation = new Error('SYNTHETIC_CALLER_PROBE_CANCELLED');
        let resolveSurvivingProbe!: (result: { status: number; body?: unknown }) => void;
        const survivingProbe = new Promise<{ status: number; body?: unknown }>(resolve => {
            resolveSurvivingProbe = resolve;
        });
        const probe = vi
            .fn()
            .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
                return new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(cancellation), { once: true });
                });
            })
            .mockImplementationOnce(() => survivingProbe);
        const detector = new ProductDetector(probe);

        const cancelled = detector.detect({ signal: cancelledController.signal });
        const surviving = detector.detect({ signal: survivingController.signal });
        const cancelledResult = cancelled.catch((error: Error) => error);
        cancelledController.abort();
        resolveSurvivingProbe({ status: 200, body: {} });

        await expect(cancelledResult).resolves.toBe(cancellation);
        await expect(surviving).resolves.toBe('mirakurun');
        await expect(detector.detect()).resolves.toBe('mirakurun');
        expect(probe).toHaveBeenCalledTimes(2);
        expect(probe.mock.calls).toEqual([
            [{ signal: cancelledController.signal }],
            [{ signal: survivingController.signal }],
        ]);
    });

    it('[TA-2.3] keeps the first completed product when independent probes succeed with competing results', async () => {
        let resolveEarlierCall!: (result: { status: number; body?: unknown }) => void;
        let resolveLaterCall!: (result: { status: number; body?: unknown }) => void;
        const earlierCall = new Promise<{ status: number; body?: unknown }>(resolve => {
            resolveEarlierCall = resolve;
        });
        const laterCall = new Promise<{ status: number; body?: unknown }>(resolve => {
            resolveLaterCall = resolve;
        });
        const probe = vi
            .fn()
            .mockImplementationOnce(() => earlierCall)
            .mockImplementationOnce(() => laterCall);
        const detector = new ProductDetector(probe);

        const earlierResult = detector.detect();
        const laterResult = detector.detect();
        resolveLaterCall({ status: 404 });
        resolveEarlierCall({ status: 200, body: {} });

        await expect(Promise.all([earlierResult, laterResult])).resolves.toEqual(['mirakc', 'mirakc']);
        await expect(detector.detect()).resolves.toBe('mirakc');
        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('[TA-2.3] forwards caller cancellation to each uncached probe', async () => {
        const controller = new AbortController();
        const probe = vi.fn(async () => ({ status: 200, body: {} }));
        const detector = new ProductDetector(probe);

        await detector.detect({ signal: controller.signal });

        expect(probe).toHaveBeenCalledWith({ signal: controller.signal });
    });

    it.each([
        [
            'a 200 object',
            (_request: IncomingMessage, response: ServerResponse) => {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end('{}');
            },
            'mirakurun',
        ],
        [
            '404',
            (_request: IncomingMessage, response: ServerResponse) => {
                response.writeHead(404);
                response.end();
            },
            'mirakc',
        ],
    ] as const)(
        '[TA-2.3] classifies the product from %s reached after a relative capability-probe redirect',
        async (_label, finalHandler, expectedProduct) => {
            const server = await startProbeRedirectServer(finalHandler);
            try {
                const transport = new TunerHttpTransport(
                    parseConnectionTarget(['http:', '', `127.0.0.1:${server.port}`].join('/')),
                    'epgstation/synthetic',
                );
                const detector = new ProductDetector(options => transport.probeJson('/api/config/server', options));

                await expect(detector.detect()).resolves.toBe(expectedProduct);
                await expect(detector.detect()).resolves.toBe(expectedProduct);
            } finally {
                await server.close();
            }
        },
    );
});
