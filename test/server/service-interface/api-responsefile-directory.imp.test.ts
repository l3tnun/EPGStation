import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { compiled, require } from './_harness';

const { responseFile } = require(compiled('model', 'service', 'api.js')) as {
    responseFile(
        request: unknown,
        response: unknown,
        filePath: string,
        mime: string,
        download?: boolean,
    ): void;
};

/**
 * Public responseFile directory guard (residual-4351 G4, api.ts L75–77).
 * Real filesystem directory → throw 'file path is derectory'.
 * No fs.stat mock; multi-listener/range paths are out of scope.
 */
describe('api.responseFile directory path throw (unittest/imp)', () => {
    let directoryPath = '';

    afterEach(async () => {
        if (directoryPath !== '') {
            await rm(directoryPath, { force: true, recursive: true });
            directoryPath = '';
        }
    });

    it('[R2-API-RESPONSEFILE-DIRECTORY] rejects when filePath is an existing directory', async () => {
        directoryPath = await mkdtemp(join(tmpdir(), 'r2-responsefile-dir-'));
        const request = { headers: {}, method: 'GET' };
        const response = {};

        // production spelling is 'derectory'
        expect(() => responseFile(request, response, directoryPath, 'video/mp2t')).toThrow(
            'file path is derectory',
        );
    });
});
