// Node の version を test・実行の分岐に使わないこと、test を skip・only・todo・fails にしないこと、version 専用の file を置かないことの検出器。
// tools/eslint-test-rules-server.mjs の規則が file ごとに呼ぶ。
import ts from 'typescript';

const hasVersionSpecificPathOverride = (path: string): boolean => {
    const normalized = path.replaceAll('\\', '/');
    return (
        /(?:^|[/_.-])node[-_.]?(?:18|26)(?:[/_.-]|$)/iu.test(normalized) &&
        /(?:runner|command|fixture|skip|allowlist|workaround|fallback)/iu.test(normalized)
    );
};
const hasRuntimeVersionBranch = (source: string): boolean => {
    const member = '(?:version|versions|release)';
    const moduleSpecifier = '[\'"](?:node:)?process[\'"]';
    const directProcessMember = new RegExp(
        `\\bprocess\\s*(?:(?:\\?\\s*\\.|\\.)\\s*${member}\\b|(?:\\?\\s*\\.)?\\[\\s*['\"]${member}['\"]\\s*\\])`,
        'u',
    );
    const namedModuleImport = new RegExp(
        `\\bimport\\s*\\{[^}]*\\b${member}\\b[^}]*\\}\\s*from\\s*${moduleSpecifier}`,
        'u',
    );
    const moduleExpression = `(?:require\\s*\\(\\s*${moduleSpecifier}\\s*\\)|(?:await\\s+)?import\\s*\\(\\s*${moduleSpecifier}\\s*\\))`;
    const destructuredProcessMember = new RegExp(
        `\\b(?:const|let|var)\\s*\\{[^}]*\\b${member}\\b[^}]*\\}\\s*=\\s*(?:process\\b|${moduleExpression})`,
        'u',
    );
    const directModuleMember = new RegExp(
        `\\(?\\s*${moduleExpression}\\s*\\)?\\s*(?:(?:\\?\\s*\\.|\\.)\\s*${member}\\b|(?:\\?\\s*\\.)?\\[\\s*['\"]${member}['\"]\\s*\\])`,
        'u',
    );

    return (
        directProcessMember.test(source) ||
        namedModuleImport.test(source) ||
        destructuredProcessMember.test(source) ||
        directModuleMember.test(source) ||
        /\bNODE_(?:VERSION|MAJOR)\b/u.test(source)
    );
};
const conditionalTestNamespaceIdentifiers = new Set(['describe', 'it', 'test']);
const conditionalTestMemberNames = new Set(['fails', 'only', 'runIf', 'skip', 'skipIf', 'todo']);
const conditionalTestCallOnlyMemberNames = new Set(['runIf', 'skipIf']);
const conditionalTestBareCallNames = new Set(['runIf', 'skipIf']);

const isConditionalTestNamespaceIdentifier = (expression: ts.Expression): boolean =>
    ts.isIdentifier(expression) && conditionalTestNamespaceIdentifiers.has(expression.text);

// Recognizes only real syntactic uses of the vitest conditional-test members, as AST nodes:
// - `it.skip`, `describe.skipIf`, `test['runIf']`, etc. reached through `it`/`test`/`describe`
//   are flagged as soon as they are referenced (a conditional expression such as
//   `const t = envSet ? it : it.skip; t(title, fn);` is a real, executable skip mechanism even
//   though `it.skip` is never written as an immediate call).
// - `<anything>.skipIf(...)` / `<anything>.runIf(...)` and a bare `skipIf(...)` / `runIf(...)`
//   are only flagged when actually invoked, matching how those two helpers are used standalone
//   (e.g. destructured from vitest and applied later).
// String literals, comments, and template literal text are never visited as property-access or
// call-expression nodes by the TypeScript AST, so synthetic fixtures that merely contain this
// text (e.g. as quoted strings inside a test) cannot be mistaken for a real reference the
// way a plain source-text regex would.
const isConditionalTestMemberAccess = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node)) {
        return conditionalTestMemberNames.has(node.name.text) && isConditionalTestNamespaceIdentifier(node.expression);
    }
    if (ts.isElementAccessExpression(node)) {
        const { argumentExpression } = node;
        return (
            ts.isStringLiteralLike(argumentExpression) &&
            conditionalTestMemberNames.has(argumentExpression.text) &&
            isConditionalTestNamespaceIdentifier(node.expression)
        );
    }
    return false;
};

const isConditionalTestCallExpression = (node: ts.CallExpression): boolean => {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
        return conditionalTestBareCallNames.has(callee.text);
    }
    if (ts.isPropertyAccessExpression(callee)) {
        return conditionalTestCallOnlyMemberNames.has(callee.name.text);
    }
    return false;
};

const hasConditionalTestInventory = (source: string): boolean => {
    if (!/\b(?:skip|skipIf|runIf|only|todo|fails)\b/u.test(source)) {
        return false;
    }

    const sourceFile = ts.createSourceFile(
        'inventory-scan.ts',
        source,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS,
    );
    let found = false;
    const visit = (node: ts.Node): void => {
        if (found) {
            return;
        }
        if (
            isConditionalTestMemberAccess(node) ||
            (ts.isCallExpression(node) && isConditionalTestCallExpression(node))
        ) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
};

export { hasConditionalTestInventory, hasRuntimeVersionBranch, hasVersionSpecificPathOverride };
