import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyServerTestPath } from '../../../scripts/server-test/test-selection.mjs';
import {
    recordingDomainSuiteMatrix,
    recordingExecutionTestTargets,
    recordingTestLayers,
} from './domain-suite-matrix.mjs';

describe('recording execution domain suite matrix', () => {
    it('registers every test file in the recording-execution directory exactly once', async () => {
        const onDisk = (await readdir(join(process.cwd(), 'test', 'server', 'recording-execution')))
            .filter(name => name.endsWith('.test.ts'))
            .map(name => `test/server/recording-execution/${name}`)
            .sort();
        expect(onDisk.length).toBeGreaterThan(0);

        const registered = recordingExecutionTestTargets.map(target => target.path);
        expect(new Set(registered).size).toBe(registered.length);
        expect([...registered].sort()).toEqual(onDisk);
    });

    it('records for each registered file the layer that the shared runner classifies it into', () => {
        for (const target of recordingExecutionTestTargets) {
            expect(recordingTestLayers).toContain(target.layer);
            expect({ layer: classifyServerTestPath(target.path), path: target.path }).toEqual({
                layer: [target.layer],
                path: target.path,
            });
        }
    });

    it('names every suite once and gives every suite at least one test', () => {
        const names = recordingDomainSuiteMatrix.map(suite => suite.name);
        expect(new Set(names).size).toBe(names.length);
        for (const suite of recordingDomainSuiteMatrix) {
            expect(suite.tests.length).toBeGreaterThan(0);
        }
    });
});
