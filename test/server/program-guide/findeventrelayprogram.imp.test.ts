import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const ProgramDB = (
    require(join(snapshot, 'model', 'db', 'ProgramDB.js')) as {
        default: new (...args: unknown[]) => {
            findEventRelayProgram(
                networkId: number,
                serviceId: number,
                eventId: number,
            ): Promise<Record<string, unknown> | null>;
        };
    }
).default;
const Program = (
    require(join(snapshot, 'db', 'entities', 'Program.js')) as {
        default: new () => Record<string, unknown>;
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real ProgramDB.findEventRelayProgram with connection/repository/retry mocked.
 * Call-site tests mock programDB entirely, leaving L414–435 uncovered.
 */
const makeFixture = (findOneResult: unknown) => {
    const findOne = vi.fn(async () => findOneResult);
    const getRepository = vi.fn(() => ({ findOne }));
    const getConnection = vi.fn(async () => ({ getRepository }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };
    const provider = new ProgramDB(
        { getLogger: () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
        { getConfig: () => ({}) },
        { getConnection },
        retry,
    );
    return { findOne, getConnection, getRepository, provider, retry };
};

describe('ProgramDB.findEventRelayProgram (unittest/imp)', () => {
    it('[R2-PROGRAMDB-FIND-EVENT-RELAY] returns the repository entity for networkId/serviceId/eventId', async () => {
        const program = {
            id: 9_001,
            networkId: 32736,
            serviceId: 1024,
            eventId: 55_001,
            name: 'synthetic-event-relay',
        };
        const fixture = makeFixture(program);

        await expect(fixture.provider.findEventRelayProgram(32736, 1024, 55_001)).resolves.toBe(program);

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        // Exact entity repository oracle (not call-count alone).
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Program);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.findOne).toHaveBeenCalledExactlyOnceWith({
            where: [
                {
                    networkId: 32736,
                    serviceId: 1024,
                    eventId: 55_001,
                },
            ],
        });
    });

    it('[R2-PROGRAMDB-FIND-EVENT-RELAY] normalizes undefined findOne result to null', async () => {
        const fixture = makeFixture(undefined);

        await expect(fixture.provider.findEventRelayProgram(1, 2, 3)).resolves.toBeNull();

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Program);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.findOne).toHaveBeenCalledExactlyOnceWith({
            where: [
                {
                    networkId: 1,
                    serviceId: 2,
                    eventId: 3,
                },
            ],
        });
    });
});
