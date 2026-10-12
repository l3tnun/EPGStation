import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedTagManadeModel = (
    require(join(snapshot, 'model', 'operator', 'recordedTag', 'RecordedTagManadeModel.js')) as {
        default: new (...args: unknown[]) => {
            create(name: string, color: string): Promise<number>;
        };
    }
).default;

describe('recorded tag creation notification', () => {
    it('[RC-8.1] notifies the created tag with its assigned id, name, color and half-width name', async () => {
        const recordedTagDB = { insertOnce: vi.fn(async () => 321) };
        const recordedTagEvent = { emitCreated: vi.fn() };
        const model = new RecordedTagManadeModel(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            recordedTagDB,
            recordedTagEvent,
        );

        await expect(model.create('ＡＢＣ tag', '#112233')).resolves.toBe(321);

        expect(recordedTagEvent.emitCreated).toHaveBeenCalledOnce();
        expect(recordedTagEvent.emitCreated).toHaveBeenCalledWith(
            expect.objectContaining({ color: '#112233', halfWidthName: 'ABC tag', id: 321, name: 'ＡＢＣ tag' }),
        );
    });

    it('[RC-8.1] does not notify when the tag cannot be stored', async () => {
        const failure = new Error('synthetic-insert-failure');
        const recordedTagDB = {
            insertOnce: vi.fn(async () => {
                throw failure;
            }),
        };
        const recordedTagEvent = { emitCreated: vi.fn() };
        const model = new RecordedTagManadeModel(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            recordedTagDB,
            recordedTagEvent,
        );

        await expect(model.create('tag', '#000000')).rejects.toBe(failure);

        expect(recordedTagEvent.emitCreated).not.toHaveBeenCalled();
    });
});
