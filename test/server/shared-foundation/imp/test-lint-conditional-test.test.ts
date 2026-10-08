import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import testRules from '../../../../tools/eslint-test-rules-server.mjs';

const lintMessages = (code: string): string[] => {
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(
        code,
        [
            {
                files: ['**/*.js'],
                plugins: { 'epgstation-test': testRules },
                rules: { 'epgstation-test/no-conditional-test': 'error' },
            },
        ],
        { filename: 'test/server/sample.test.js' },
    );
    return messages.map(message => message.ruleId ?? message.message);
};

describe('no-conditional-test', () => {
    it.each(['skip', 'only', 'todo', 'fails'])('reports %s on it, test and describe', member => {
        for (const namespace of ['it', 'test', 'describe']) {
            expect(lintMessages(`${namespace}.${member}('case', () => {});`)).toEqual([
                'epgstation-test/no-conditional-test',
            ]);
        }
    });

    it.each(['skip', 'only', 'todo', 'fails'])('reports bracket notation for %s', member => {
        expect(lintMessages(`it['${member}']('case', () => {});`)).toEqual(['epgstation-test/no-conditional-test']);
    });

    it('reports skipIf and runIf calls', () => {
        expect(lintMessages("it.skipIf(true)('case', () => {});")).toEqual(['epgstation-test/no-conditional-test']);
        expect(lintMessages("runIf(true)('case', () => {});")).toEqual(['epgstation-test/no-conditional-test']);
    });

    it('does not report plain cases or the words inside strings and comments', () => {
        expect(lintMessages("it('only', () => {});\n// it.only is not allowed\nconst note = 'it.todo';")).toEqual([]);
        expect(
            lintMessages("it('case', () => {}); describe('group', () => { it.each([1])('n', () => {}); });"),
        ).toEqual([]);
    });
});
