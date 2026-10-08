import { describe, expect, it, vi } from 'vitest';

import { createOperator, type TestLogger } from './harness';
import { cleanupOfficialMySqlLtsSession, provisionOfficialMySqlLts } from './mysql-lts-runtime';

const logger = (): TestLogger => ({ system: { error: vi.fn(), info: vi.fn() } });

describe('DBOperator official MySQL LTS connection integration', () => {
    it('[PERSIST-8.4-NO-WEAK-AUTH] provisions official LTS without deleted-plugin or weakened-auth options', async () => {
        const runtime = await provisionOfficialMySqlLts();
        try {
            expect(runtime.imageTag).toBe('mysql:lts');
            expect(runtime.imageDigest.startsWith('mysql@sha256:')).toBe(true);
            expect(runtime.mysqldArguments.join(' ')).not.toMatch(/mysql-native-password|authentication-policy/u);
        } finally {
            await cleanupOfficialMySqlLtsSession({ runtime });
        }
    }, 90_000);

    it('[PERSIST-8.2-LTS-CONNECT-CLOSE] completes official LTS Configuration→DBOperator publication and close', async () => {
        const runtime = await provisionOfficialMySqlLts();
        let schema: Awaited<ReturnType<typeof runtime.createSchema>> | undefined;
        let operator: ReturnType<typeof createOperator> | undefined;
        let source: { isInitialized: boolean } | undefined;
        try {
            schema = await runtime.createSchema();
            operator = createOperator({ dbtype: 'mysql', mysql: schema.config }, logger());
            source = await operator.getConnection();

            expect(source.isInitialized).toBe(true);
            await expect(operator.checkConnection()).resolves.toBeUndefined();
            await expect(operator.getConnection()).resolves.toBe(source);
            await expect(operator.closeConnection()).resolves.toBeUndefined();
            expect(source.isInitialized).toBe(false);
        } finally {
            await cleanupOfficialMySqlLtsSession({ operator, source, schema, runtime });
        }
    }, 90_000);

    it('[PERSIST-8.2-LTS-CLEANUP-AGGREGATE] still closes the operator and runtime after schema cleanup rejection', async () => {
        const closeOrder: string[] = [];
        const schemaError = new Error('SYNTHETIC_SCHEMA_CLEANUP_REJECTION');
        const operator = {
            closeConnection: vi.fn(async () => {
                closeOrder.push('operator');
            }),
        };
        const source = { isInitialized: true };
        const schema = {
            cleanup: vi.fn(async () => {
                closeOrder.push('schema');
                throw schemaError;
            }),
        };
        const runtime = {
            cleanup: vi.fn(async () => {
                closeOrder.push('runtime');
            }),
        };

        await expect(cleanupOfficialMySqlLtsSession({ operator, source, schema, runtime })).rejects.toMatchObject({
            name: 'AggregateError',
            errors: [schemaError],
        });
        expect(closeOrder).toEqual(['operator', 'schema', 'runtime']);
        expect(runtime.cleanup).toHaveBeenCalledTimes(1);
    });
});
