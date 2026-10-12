// server の test の書き方のうち、構文から機械的に判定できる規則。root の eslint.config.mjs が
// `test/server` と `scripts/server-test` に適用する。規則の一覧と範囲・例外は
// .kiro/steering/server-testing.md「testを書く規則」にある。
import { tmpdir } from 'node:os';
import path from 'node:path';

import { calleeName, isProcessIdentifier, keyName, memberName } from './eslint-rule-utils.mjs';
import { contentFindings } from './eslint-fixture-scan.ts';
import {
    hasConditionalTestInventory,
    hasRuntimeVersionBranch,
    hasVersionSpecificPathOverride,
} from './eslint-version-scan.ts';

const relativePath = context => path.relative(context.cwd, context.filename).split(path.sep).join('/');
const fileStart = { line: 1, column: 0 };

const noVersionBranch = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            version:
                'Node の version（`process.version`・`process.versions`・`process.release`・`NODE_VERSION`・`NODE_MAJOR`）で test や実行を分岐しない。',
        },
    },
    create(context) {
        return {
            Program() {
                if (hasRuntimeVersionBranch(context.sourceCode.text)) {
                    context.report({ loc: fileStart, messageId: 'version' });
                }
            },
        };
    },
};

const noConditionalTest = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            conditional:
                'test を `.skip`・`.skipIf`・`.runIf`・`.only`・`.todo`・`.fails` で無効化・条件付け・限定しない（`skipIf(...)`・`runIf(...)` の呼出しも同じ）。',
        },
    },
    create(context) {
        return {
            Program() {
                if (hasConditionalTestInventory(context.sourceCode.text)) {
                    context.report({ loc: fileStart, messageId: 'conditional' });
                }
            },
        };
    },
};

const noVersionSpecificFile = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            file: 'Node の version 専用の runner・command・fixture・skip・allowlist・workaround・fallback の file を作らない。',
        },
    },
    create(context) {
        return {
            Program() {
                if (hasVersionSpecificPathOverride(relativePath(context))) {
                    context.report({ loc: fileStart, messageId: 'file' });
                }
            },
        };
    },
};

const referencesProcessPlatform = node => {
    if (node === null || typeof node !== 'object') return false;
    if (node.type === 'MemberExpression' && isProcessIdentifier(node.object) && memberName(node) === 'platform')
        return true;
    return Object.entries(node).some(([key, value]) => {
        if (key === 'parent' || key === 'loc' || key === 'range') return false;
        if (Array.isArray(value)) return value.some(referencesProcessPlatform);
        return (
            value !== null &&
            typeof value === 'object' &&
            typeof value.type === 'string' &&
            referencesProcessPlatform(value)
        );
    });
};

const isEarlyExit = statement => {
    if (statement === undefined || statement === null) return false;
    if (statement.type === 'ReturnStatement' || statement.type === 'ContinueStatement') return true;
    if (statement.type === 'BlockStatement') {
        const first = statement.body[0];
        return first !== undefined && (first.type === 'ReturnStatement' || first.type === 'ContinueStatement');
    }
    return false;
};

const noPlatformEarlyReturn = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            platform:
                '`process.platform` で test の本体を抜けない（`if (process.platform ...) return;`）。OS 依存の file は、実行する環境で選ぶ。',
        },
    },
    create(context) {
        return {
            IfStatement(node) {
                if (referencesProcessPlatform(node.test) && isEarlyExit(node.consequent)) {
                    context.report({ node, messageId: 'platform' });
                }
            },
        };
    },
};

const noRealFixtureValue = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            real: 'fixture に実在し得る値を書かない（{{category}}、{{location}}）。合成値（`.invalid`・loopback・`<...>`・`synthetic-` 始まり）にする。',
        },
    },
    create(context) {
        return {
            Program() {
                const findings = contentFindings(context.sourceCode.text, relativePath(context), {
                    testTempRoots: [tmpdir()],
                });
                for (const finding of findings) context.report({ loc: fileStart, messageId: 'real', data: finding });
            },
        };
    },
};

// ---- 子 process の env の形と、source text を実行する呼出し、src の直接 import ----

// `process?.env` は `process.env` と同じに扱う。
const unwrapChain = node => (node?.type === 'ChainExpression' ? node.expression : node);

const isProcessEnv = candidate => {
    const node = unwrapChain(candidate);
    return (
        node?.type === 'MemberExpression' &&
        !node.computed &&
        isProcessIdentifier(node.object) &&
        node.property.name === 'env'
    );
};

const isProcessEnvCoverage = candidate => {
    const node = unwrapChain(candidate);
    return (
        node?.type === 'MemberExpression' &&
        !node.computed &&
        isProcessEnv(node.object) &&
        node.property.name === 'NODE_V8_COVERAGE'
    );
};

const COVERAGE_ENV = 'NODE_V8_COVERAGE';

// `...process.env` を 1 つだけ展開し、ほかの展開と `NODE_V8_COVERAGE` の property を持たない object literal。
const isSafeEnvObject = literal => {
    let processEnvSpreads = 0;
    let otherSpreads = 0;
    for (const property of literal.properties) {
        if (property.type === 'SpreadElement') {
            if (isProcessEnv(property.argument)) processEnvSpreads += 1;
            else otherSpreads += 1;
            continue;
        }
        const name = keyName(property);
        if (name === undefined || name === COVERAGE_ENV) return false;
    }
    return processEnvSpreads === 1 && otherSpreads === 0;
};

// 先頭が `...process.env`、展開はもう 1 つまで、最後が `NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE` の object literal。
const isSafeEnvObjectWithCoverageRepin = literal => {
    const { properties } = literal;
    if (properties.length < 2) return false;
    const [first] = properties;
    if (first.type !== 'SpreadElement' || !isProcessEnv(first.argument)) return false;
    let spreads = 1;
    for (const property of properties.slice(1, -1)) {
        if (property.type === 'SpreadElement') {
            spreads += 1;
            continue;
        }
        const name = keyName(property);
        if (name === undefined || name === COVERAGE_ENV) return false;
    }
    if (spreads > 2) return false;
    const last = properties[properties.length - 1];
    if (last.type === 'SpreadElement' || keyName(last) !== COVERAGE_ENV) return false;
    return !last.shorthand && !last.method && last.kind === 'init' && isProcessEnvCoverage(last.value);
};

const isSafeEnvExpression = expression => {
    if (isProcessEnv(expression)) return true;
    if (expression.type !== 'ObjectExpression') return false;
    return isSafeEnvObject(expression) || isSafeEnvObjectWithCoverageRepin(expression);
};

const findEnvValue = args => {
    for (const arg of args) {
        if (arg.type !== 'ObjectExpression') continue;
        for (const property of arg.properties) {
            if (property.type === 'SpreadElement' || keyName(property) !== 'env') continue;
            return property.value;
        }
    }
    return undefined;
};

const stringArgumentsInclude = (nodes, substring) =>
    nodes.some(node => {
        if (node.type === 'Literal' && typeof node.value === 'string')
            return node.value.toLowerCase().includes(substring);
        if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
            return (node.quasis[0].value.cooked ?? '').toLowerCase().includes(substring);
        }
        if (node.type === 'ArrayExpression') return stringArgumentsInclude(node.elements.filter(Boolean), substring);
        return false;
    });

const childEnvInherited = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            env: '子 process（`spawn`・`fork`・vitest を起動する `execFile`）の `env` は、`process.env` を引き継ぐ形に限る（指定しない、`process.env`、`{ ...process.env }`、末尾で `NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE` を指定し直す形）。coverage の計測が子 process に届かなくなるため、`env` を別の object にしない。',
        },
    },
    create(context) {
        return {
            CallExpression(node) {
                const name = calleeName(node.callee);
                const isSpawnOrFork = name === 'spawn' || name === 'fork';
                const isVitestExecFile = name === 'execFile' && stringArgumentsInclude(node.arguments, 'vitest');
                if (!isSpawnOrFork && !isVitestExecFile) return;
                const env = findEnvValue(node.arguments);
                if (env !== undefined && !isSafeEnvExpression(env)) context.report({ node, messageId: 'env' });
            },
        };
    },
};

const noDynamicEval = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            eval: '`Function(...)`・`new Function(...)`・`eval(...)` で source text を実行しない。実在する file を `require()`・`import()` する。',
        },
    },
    create(context) {
        const check = node => {
            const name = calleeName(node.callee);
            if (name === 'Function' || (node.type === 'CallExpression' && name === 'eval')) {
                context.report({ node, messageId: 'eval' });
            }
        };
        return {
            CallExpression: check,
            NewExpression: node =>
                calleeName(node.callee) === 'Function' && context.report({ node, messageId: 'eval' }),
        };
    },
};

const SRC_SPECIFIER = /^(\.\.\/)+src\//u;
// 文字列 literal と、式を含まない template literal。
const isSrcSpecifier = node => {
    if (node?.type === 'Literal') return typeof node.value === 'string' && SRC_SPECIFIER.test(node.value);
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
        return SRC_SPECIFIER.test(node.quasis[0].value.cooked ?? '');
    return false;
};

const noDirectSrcImport = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            src: '`src/` を値として直接 import しない。test は production と同じ compile 済みの `dist` を import する（型だけの `import type` は可）。',
        },
    },
    create(context) {
        const report = node => context.report({ node, messageId: 'src' });
        return {
            ImportDeclaration(node) {
                if (!isSrcSpecifier(node.source) || node.importKind === 'type') return;
                // 副作用だけの import、default・namespace の import、`type` が付かない named specifier のいずれかがあれば値の import。
                const valueSpecifier =
                    node.specifiers.length === 0 ||
                    node.specifiers.some(
                        specifier => specifier.type !== 'ImportSpecifier' || specifier.importKind !== 'type',
                    );
                if (valueSpecifier) report(node);
            },
            ImportExpression(node) {
                if (isSrcSpecifier(node.source)) report(node);
            },
            CallExpression(node) {
                if (calleeName(node.callee) === 'require' && isSrcSpecifier(node.arguments[0])) report(node);
            },
            TSImportEqualsDeclaration(node) {
                if (node.importKind === 'type') return;
                if (
                    node.moduleReference.type === 'TSExternalModuleReference' &&
                    isSrcSpecifier(node.moduleReference.expression)
                ) {
                    report(node);
                }
            },
            ExportNamedDeclaration(node) {
                if (!isSrcSpecifier(node.source) || node.exportKind === 'type') return;
                if (node.specifiers.some(specifier => specifier.exportKind !== 'type')) report(node);
            },
            ExportAllDeclaration(node) {
                if (isSrcSpecifier(node.source) && node.exportKind !== 'type') report(node);
            },
        };
    },
};

export default {
    rules: {
        'no-version-branch': noVersionBranch,
        'no-conditional-test': noConditionalTest,
        'no-version-specific-file': noVersionSpecificFile,
        'no-platform-early-return': noPlatformEarlyReturn,
        'no-real-fixture-value': noRealFixtureValue,
        'child-env-inherited': childEnvInherited,
        'no-dynamic-eval': noDynamicEval,
        'no-direct-src-import': noDirectSrcImport,
    },
};

// `test/server` と `scripts/server-test` の、Node の version・skip・version 専用 file の規則。
export const serverVersionRules = {
    'epgstation-test/no-version-branch': 'error',
    'epgstation-test/no-conditional-test': 'error',
    'epgstation-test/no-version-specific-file': 'error',
};

// `test/server` 全体の file が対象の規則。
export const serverFixtureRules = {
    'epgstation-test/no-real-fixture-value': 'error',
};

// `test/server` の `.ts` が対象の規則。
export const serverCodeRules = {
    'epgstation-test/child-env-inherited': 'error',
    'epgstation-test/no-direct-src-import': 'error',
};

// `test/server` の `.ts`・`.js`・`.cjs` が対象の規則。
export const serverEvalRules = {
    'epgstation-test/no-dynamic-eval': 'error',
};

// `test/server/application-runtime`・`test/server/tuner-access` の `*.test.ts` が対象の規則。
export const serverPlatformRules = {
    'epgstation-test/no-platform-early-return': 'error',
};
