import { afterEach, describe, expect, it } from 'vitest';

import {
    healthyTunerHandler,
    reserveUnusedPort,
    respondJson,
    serviceAnswers,
    sleep,
    startOperator,
    startTunerStub,
    waitFor,
    type OperatorHandle,
    type TunerStub,
    type TunerStubHandler,
} from '../harness/real-operator';

/**
 * [AR-3.6][AR-3.7] against the compiled Operator running as a real process, with a real loopback tuner
 * server. Wall-clock limits here only bound a hung run. What the spec forbids is a deadline that ends the
 * wait, so every assertion is about the Operator still waiting (alive, no fatal record, one attempt at a
 * time) and then proceeding once the dependency answers.
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];

afterEach(async () => {
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

const start = async (handler: TunerStubHandler, config: readonly string[] = []): Promise<OperatorHandle> => {
    const stub = await startTunerStub(handler);
    stubs.push(stub);
    const operator = await startOperator({ config, servicePort: await reserveUnusedPort(), tunerPort: stub.port });
    operators.push(operator);
    return operator;
};

describe('[AR-3.6] the wait for a dependency has no deadline (real process)', () => {
    it('keeps retrying about once a second while the tuner server answers 503, records no fatal, then proceeds', async () => {
        const healthy = healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]);
        const failuresBeforeRecovery = 6;
        let statusRequests = 0;
        const stub = await startTunerStub((request, response, context) => {
            if (request.url?.startsWith('/api/status') === true) {
                statusRequests += 1;
                if (statusRequests <= failuresBeforeRecovery) {
                    respondJson(response, { error: 'unavailable' }, 503);
                    return;
                }
            }
            healthy(request, response, context);
        });
        stubs.push(stub);
        const operator = await startOperator({ servicePort: await reserveUnusedPort(), tunerPort: stub.port });
        operators.push(operator);

        await waitFor(() => statusRequests > failuresBeforeRecovery, 'the recovered /api/status request', () => ({
            statusRequests,
            stdout: operator.stdout(),
        }));

        // The lower bound is deterministic: every failed attempt is followed by a one second sleep, so six
        // failures cannot be retried faster than the retry interval. No upper bound is asserted.
        const arrivals = stub.arrivals.filter((_, index) => stub.requests[index].startsWith('/api/status'));
        expect(arrivals[failuresBeforeRecovery] - arrivals[0]).toBeGreaterThanOrEqual(failuresBeforeRecovery * 1000 - 500);
        for (let index = 1; index <= failuresBeforeRecovery; index += 1) {
            expect(arrivals[index] - arrivals[index - 1]).toBeGreaterThanOrEqual(900);
        }

        await waitFor(() => serviceAnswers(operator.servicePort), 'the Service after the dependency recovered', () => ({
            stdout: operator.stdout(),
        }));
        expect(operator.isAlive()).toBe(true);
        expect(operator.count('check mirakurun')).toBe(failuresBeforeRecovery + 1);
        expect(operator.count('check db')).toBe(1);
        expect(await operator.readSystemLog()).not.toMatch(/fatal|FATAL/u);
        expect(operator.stdout()).not.toContain('initialize error');
    }, 60_000);
});

describe('[AR-3.7] one attempt has no time limit of its own (real process)', () => {
    it('keeps a single silent connection past the configured REST request timeout, then proceeds when it answers', async () => {
        const healthy = healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]);
        let heldStatus: { end: (body: string) => void; setHeader: (name: string, value: string) => void } | undefined;
        const restTimeoutMs = 1_500;
        const operator = await start(
            (request, response, context) => {
                if (request.url?.startsWith('/api/status') === true && heldStatus === undefined) {
                    // Neither a header nor a body: the attempt stays pending until the test lets it go.
                    heldStatus = response;
                    return;
                }
                healthy(request, response, context);
            },
            [`tunerRestRequestTimeoutMs: ${restTimeoutMs}`],
        );
        const stub = stubs[0];

        await waitFor(() => heldStatus !== undefined, 'the first /api/status request', () => operator.stdout());
        // Three times the configured REST timeout (the v3 default is 30 s; it is shortened here so the
        // limit can be exceeded in real time): the attempt must neither be cut off nor repeated.
        await sleep(restTimeoutMs * 3);
        expect(stub.requests.filter(path => path.startsWith('/api/status'))).toHaveLength(1);
        expect(stub.connectionCount()).toBe(1);
        expect(stub.openConnectionCount()).toBe(1);
        expect(operator.isAlive()).toBe(true);
        expect(operator.count('check mirakurun')).toBe(1);
        expect(operator.count('check db')).toBe(0);
        expect(await operator.readSystemLog()).not.toMatch(/fatal|FATAL/u);

        // Answering the held request lets startup go on.
        heldStatus!.setHeader('content-type', 'application/json');
        heldStatus!.end(JSON.stringify({ version: 'synthetic' }));
        await waitFor(() => serviceAnswers(operator.servicePort), 'the Service after the held attempt answered', () => ({
            stdout: operator.stdout(),
        }));
        expect(operator.count('check mirakurun')).toBe(1);
        expect(operator.count('check db')).toBe(1);
    }, 60_000);
});
