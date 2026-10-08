import { describe, expect, it } from 'vitest';

import {
    connectPollingSocketIoClient,
    exchange,
    expectedTlsMaterial,
    listenerMatrixCases,
    originOf,
    startListenerFixture,
    startPublicSurfaceFixture,
    type ListenerMatrixCase,
    type ListenerProtocol,
} from './fixtures/listener-matrix';
import {
    syntheticClientCertificateAuthority,
    trustedSyntheticClientIdentity,
    untrustedSyntheticClientIdentity,
} from './fixtures/synthetic-mtls';

const expectedRequestedListenPorts = (caseDefinition: ListenerMatrixCase): readonly number[] => [
    ...(caseDefinition.https === null ? [] : caseDefinition.https.dedicatedSocketIo ? [-20_101, -20_102] : [0]),
    ...(caseDefinition.http === null ? [] : caseDefinition.http.dedicatedSocketIo ? [-10_101, -10_102] : [0]),
];
const sortedPortMultiset = (ports: readonly number[]): readonly number[] =>
    [...ports].sort((left, right) => left - right);

const canonicalListenerCases = [
    { id: 'SI-8.1', observable: 'starts configured HTTP listeners', caseLocator: 'test/server/service-interface/listener.spec.test.ts%%starts every enabled listener once and every unconfigured listener zero times: $name%%expect(Object.fromEntries(startsByProtocol)).toEqual(' },
    { id: 'SI-8.2', observable: 'starts configured HTTPS listeners', caseLocator: 'test/server/service-interface/listener.spec.test.ts%%starts every enabled listener once and every unconfigured listener zero times: $name%%expect(fixture.tlsOptions).toHaveLength(' },
    { id: 'SI-8.3', observable: 'uses the HTTPS client-certificate listener boundary', caseLocator: 'test/server/service-interface/listener.spec.test.ts%%requires a trusted client certificate with $name%%await expect(exchange(' },
    { id: 'SI-8.4', observable: 'uses the Web and API CORS listener boundary', caseLocator: 'test/server/service-interface/listener.spec.test.ts%%returns the configured Web and API CORS response when $name%%expect(response.headers' },
    { id: 'SI-8.5', observable: 'uses the Socket.IO CORS listener boundary', caseLocator: 'test/server/service-interface/listener.spec.test.ts%%keeps every representative public surface available without an Authorization header%%expect(notification.confirmation).toMatchObject(' },
    { id: 'SI-8.6', observable: 'keeps public listener surfaces unauthenticated', caseLocator: 'test/server/service-interface/listener.spec.test.ts%%keeps every representative public surface available without an Authorization header%%expect(response.headers[' },
] as const;

describe('Service Interface listener start matrix [Task 7.1][SI-7.1][LS#SI-8.1][LS#SI-8.2]', () => {
    it.each(canonicalListenerCases)('[$id] $observable [$caseLocator]', async ({ id }) => {
        const caseDefinition =
            id === 'SI-8.1'
                ? listenerMatrixCases.find(candidate => candidate.http !== null)
                : listenerMatrixCases.find(candidate => candidate.https !== null);
        if (caseDefinition === undefined) throw new Error(`Missing listener observable fixture for ${id}`);
        const fixture = await startListenerFixture(caseDefinition);

        try {
            expect(fixture.starts).toHaveLength(caseDefinition.expectedStarts.http + caseDefinition.expectedStarts.https);
            expect(fixture.applications).toHaveLength(
                Number(caseDefinition.http !== null) + Number(caseDefinition.https !== null),
            );
        } finally {
            await fixture.cleanup();
        }
    });

    it.each(listenerMatrixCases)(
        'starts every enabled listener once and every unconfigured listener zero times: $name',
        async caseDefinition => {
            const fixture = await startListenerFixture(caseDefinition);

            try {
                const startsByProtocol = (['http', 'https'] as const).map(protocol => [
                    protocol,
                    fixture.starts.filter(listener => listener.protocol === protocol).length,
                ]);
                expect(Object.fromEntries(startsByProtocol)).toEqual(caseDefinition.expectedStarts);
                expect(new Set(fixture.starts.map(listener => listener.server)).size).toBe(fixture.starts.length);
                expect(sortedPortMultiset(fixture.requestedListenPorts)).toEqual(
                    sortedPortMultiset(expectedRequestedListenPorts(caseDefinition)),
                );
                expect(fixture.applications).toHaveLength(
                    Number(caseDefinition.http !== null) + Number(caseDefinition.https !== null),
                );
                expect(fixture.notificationListeners).toHaveLength(
                    Number(caseDefinition.http !== null) + Number(caseDefinition.https !== null),
                );

                for (const protocol of ['http', 'https'] as const satisfies readonly ListenerProtocol[]) {
                    const definition = caseDefinition[protocol];
                    const application = fixture.applications.find(listener => listener.protocol === protocol);
                    const notification = fixture.notificationListeners.find(listener => listener.protocol === protocol);
                    if (definition === null) {
                        expect(application).toBeUndefined();
                        expect(notification).toBeUndefined();
                        continue;
                    }
                    expect(application).toBeDefined();
                    expect(notification).toBeDefined();
                    if (definition.dedicatedSocketIo) {
                        expect(notification?.server).not.toBe(application?.server);
                        expect(application?.notification).toBe(false);
                    } else {
                        expect(notification?.server).toBe(application?.server);
                        expect(application?.notification).toBe(true);
                    }
                }

                const expectedTlsStarts = caseDefinition.expectedStarts.https;
                expect(fixture.tlsOptions).toHaveLength(expectedTlsStarts);
                if (expectedTlsStarts > 0) {
                    const expected = await expectedTlsMaterial();
                    for (const options of fixture.tlsOptions) {
                        expect(options.key).toEqual(expected.key);
                        expect(options.cert).toEqual(expected.cert);
                    }
                }
            } finally {
                await fixture.cleanup();
            }
        },
    );
});

describe('Service Interface client certificate boundary [Task 7.2][LS#SI-8.3]', () => {
    it.each([
        { certificateAuthority: syntheticClientCertificateAuthority(), name: 'a single CA path' },
        { certificateAuthority: [syntheticClientCertificateAuthority()], name: 'a one-element CA path array' },
    ] as const)('requires a trusted client certificate with $name', async ({ certificateAuthority }) => {
        const fixture = await startListenerFixture(
            {
                expectedStarts: { http: 0, https: 2 },
                http: null,
                https: { dedicatedSocketIo: true },
                name: 'HTTPS client certificate with dedicated Socket.IO listener',
            },
            { clientCertificateAuthority: certificateAuthority },
        );

        try {
            const application = fixture.applications.find(listener => listener.protocol === 'https');
            const notification = fixture.notificationListeners.find(listener => listener.protocol === 'https');
            if (application === undefined || notification === undefined) {
                throw new Error('Task 7.2 fixture omitted an HTTPS public listener');
            }
            const trustedClient = trustedSyntheticClientIdentity();
            const untrustedClient = untrustedSyntheticClientIdentity();

            await expect(exchange(await originOf(application), '/api/docs', { clientTls: trustedClient })).resolves.toMatchObject({
                status: 200,
            });
            await expect(connectPollingSocketIoClient(notification, { clientTls: trustedClient })).resolves.toMatchObject({
                confirmation: { status: 200 },
            });
            const applicationOrigin = await originOf(application);
            await Promise.all([
                expect(exchange(applicationOrigin, '/api/docs')).rejects.toBeInstanceOf(Error),
                expect(connectPollingSocketIoClient(notification)).rejects.toBeInstanceOf(Error),
                expect(exchange(applicationOrigin, '/api/docs', { clientTls: untrustedClient })).rejects.toBeInstanceOf(Error),
                expect(connectPollingSocketIoClient(notification, { clientTls: untrustedClient })).rejects.toBeInstanceOf(Error),
            ]);
        } finally {
            await fixture.cleanup();
        }
    });
});

describe('Service Interface CORS boundary [Task 7.2][LS#SI-8.4]', () => {
    it.each([
        { isAllowAllCORS: true, name: 'allow-all enabled', responseOrigin: '*' },
        { isAllowAllCORS: false, name: 'allow-all disabled', responseOrigin: undefined },
    ] as const)('returns the configured Web and API CORS response when $name', async expected => {
        const fixture = await startPublicSurfaceFixture(expected.isAllowAllCORS);

        try {
            const origins = ['https://first.synthetic.invalid', 'https://second.synthetic.invalid'];
            const responses = await Promise.all(
                origins.flatMap(origin => [
                    exchange(fixture.origin, '/', { headers: { Origin: origin } }),
                    exchange(fixture.origin, '/api/config', { headers: { Origin: origin } }),
                ]),
            );
            for (const response of responses) {
                expect(response.status).toBe(200);
                expect(response.headers['access-control-allow-origin']).toBe(expected.responseOrigin);
            }
        } finally {
            await fixture.cleanup();
        }
    });
});

describe('Service Interface public surface boundary [Task 7.2][LS#SI-8.5][LS#SI-8.6]', () => {
    it('keeps every representative public surface available without an Authorization header', async () => {
        const fixture = await startPublicSurfaceFixture(true);

        try {
            const notification = await connectPollingSocketIoClient(fixture.notificationListener, {
                headers: { Origin: 'https://notification.synthetic.invalid' },
            });
            const [web, api, image, video, document] = await Promise.all([
                exchange(fixture.origin, '/', { headers: { Origin: 'https://web.synthetic.invalid' } }),
                exchange(fixture.origin, '/api/config', { headers: { Origin: 'https://api.synthetic.invalid' } }),
                exchange(fixture.origin, '/thumbnail/task-7-2-thumbnail.png'),
                exchange(fixture.origin, '/streamfiles/task-7-2-video.ts'),
                exchange(fixture.origin, '/api/docs'),
            ]);

            expect(web).toMatchObject({ body: 'task-7-2-web', status: 200 });
            expect(api).toMatchObject({ body: JSON.stringify({ broadcast: true }), status: 200 });
            expect(image).toMatchObject({ status: 200 });
            expect(image.headers['content-type']).toContain('image/png');
            expect(video).toMatchObject({ status: 200 });
            expect(video.headers['content-type']).toContain('video/mpeg');
            expect(document).toMatchObject({ status: 200 });
            expect(notification.confirmation).toMatchObject({
                headers: { 'access-control-allow-origin': '*' },
                status: 200,
            });
            for (const response of [web, api, image, video, document, notification.confirmation]) {
                expect(response.headers['www-authenticate']).toBeUndefined();
            }
        } finally {
            await fixture.cleanup();
        }
    });
});
