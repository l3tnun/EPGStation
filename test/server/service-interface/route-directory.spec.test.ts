import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compiled } from './_harness';

/** 再帰的に `.js` file を列挙する。 */
const listModules = (directory: string): string[] =>
    readdirSync(directory).flatMap(name => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? listModules(path) : name.endsWith('.js') ? [path] : [];
    });

describe('route の読み込み directory (unittest/spec)', () => {
    it('[SI-1.3] src/model/service/api の module はすべて HTTP method の operation を持ち、補助 module を含まない', () => {
        const root = compiled('model', 'service', 'api');
        const modules = listModules(root);
        expect(modules.length).toBeGreaterThan(0);

        const withoutOperation = modules
            .filter(
                path =>
                    !/(?:exports\.|export\s+const\s+)(?:get|post|put|patch|del|delete)\b/.test(
                        readFileSync(path, 'utf8'),
                    ),
            )
            .map(path => relative(root, path));

        // 操作の無い file は express-openapi に path として拾われ、`/api/docs` の `paths` に空の項目が現れる。
        expect(withoutOperation).toEqual([]);
    });
});
