// fixture に実在し得る値（URL・IP address・credential・番組名・チューナー名・絶対の保存 path）を書かない規則の検出器。
// tools/eslint-test-rules-server.mjs の `no-real-fixture-value` が file ごとに `contentFindings` を呼ぶ。
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { isIP } from 'node:net';
import ts from 'typescript';

export type FixtureFindingCategory =
    | 'url'
    | 'ip-address'
    | 'credential'
    | 'program-data'
    | 'tuner-data'
    | 'absolute-storage-path'
    | 'uninspectable';

export interface FixtureFinding {
    readonly category: FixtureFindingCategory;
    readonly location: string;
}

export interface FixtureScanOptions {
    readonly testTempRoots?: readonly string[];
}

const credentialKey =
    /^(?:apiKey|accessToken|authToken|bearerToken|clientSecret|cookie|credentials?|password|privateKey|secret|session|token|user|username)$/i;
const programKey = /^(?:programName|programTitle)$/i;
const tunerKey = /^(?:tunerName|tunerHost)$/i;
const pathKey = /(?:directory|filePath|storagePath)$/i;
// `subDirectory` (IConfigFile.ts) is a URL prefix normalized by Configuration.ts via
// `urljoin('/', newConfig.subDirectory)`; the contract name cannot change, and a leading `/` is
// therefore a production-shaped value, not a filesystem path. commonAbsolutePathPattern below
// still flags any real storage root written into it (e.g. `/var/...`, `/home/...`).
const urlPrefixPathKey = /^subDirectory$/;
const urlPattern = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/giu;
const ipAddressPattern = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/gu;
// IPv6 literal は識別子の途中からは始まらないので、直前が word 文字でないことを要求する。`::` は `<file>::<project>::<case>`
// のような区切りにも使われ、直前の識別子が 16 進の文字で終わると、区切りと隣の文字から `net.isIP` が IPv6 として
// 受け入れる短い文字列ができてしまう。末尾の境界は変えない（引用符・括弧・代入・URL に埋め込んだ address も検出する）。
// address や保存 root を file に literal で書くと、その file 自身が検出されるので、`join` で組み立てて書く。
const ipv6Pattern = new RegExp(
    ['(?<![\\w:])(?:[\\da-f]{0,4}', ':', '){2,7}[\\da-f]{0,4}(?![\\da-f:])'].join(''),
    'giu',
);
const credentialPattern = /\b(?:basic|bearer)\s+[a-z\d._~+/-]+=*/iu;
const commonAbsolutePathPattern = /(?:^|[\s"'(])(?:\/(?:data|home|media|mnt|opt|srv|var)\/|[a-z]:[\\/])/imu;
// Addresses that never identify a specific host: the IPv4/IPv6 "any" (unspecified) address and
// the IPv4/IPv6 loopback address. This is an exact-match enumeration, not a range, so any other
// address in the same families still triggers a finding.
const nonIdentifyingAddresses = new Set(['0.0.0.0', '127.0.0.1', '::', '::1']);
// path の key は、末尾の directory|filePath|storagePath だけでなく先頭の識別子全体（`subDirectory`、`recordedDirectory`）を
// 取る。接尾辞だけを取ると、source に無い key（`Directory`）になり、`urlPrefixPathKey` の判定が効かず、`.md`・`.yml`・`.txt`・
// 解析できない `.json` のように raw text だけを通る file の `recordedDirectory`・`logFilePath` を見落とす。lookbehind で
// 識別子の途中から始まらないようにする。この分岐だけの規則で、credential・番組・tuner の分岐は変えない。
const sensitiveSourceLiteralPattern =
    /["']?(?:(?<![A-Za-z\d_])([A-Za-z\d_]*(?:directory|filePath|storagePath))|(apiKey|accessToken|authToken|bearerToken|clientSecret|cookie|credentials?|password|privateKey|secret|session|token|user|username|programName|programTitle|tunerName|tunerHost))["']?\s*[:=]\s*(["'])([^"'`\r\n]+)\3/giu;
const sourceFilePattern = /\.[cm]?[jt]sx?$/iu;

type SourceLiteral = string | number | boolean | null | SourceLiteral[] | { readonly [key: string]: SourceLiteral };

const unresolvedSourceLiteral = Symbol('unresolved-source-literal');
type SourceLiteralResult = SourceLiteral | typeof unresolvedSourceLiteral;

function isSynthetic(value: string): boolean {
    return /^<[^<>]+>$/.test(value) || /^(?:synthetic|test)(?:-|_)/i.test(value);
}

function parseUrl(value: string): URL | undefined {
    try {
        return new URL(value);
    } catch {
        return undefined;
    }
}

function isAllowedUrl(value: URL): boolean {
    const hostname = value.hostname.toLowerCase();
    if (hostname === 'invalid' || hostname.endsWith('.invalid')) {
        return true;
    }
    // Writing the same non-identifying address (the exact 4-element enumeration, not a range) as
    // a URL host rather than a bare literal is not a meaningfully different fixture shape; the
    // bare-literal form is already exempt via `isNonIdentifyingAddress` below.
    return isNonIdentifyingAddress(unbracketedHostname(hostname));
}

function isIpv4Address(value: string): boolean {
    return isIP(value) === 4;
}

function isNonIdentifyingAddress(value: string): boolean {
    return nonIdentifyingAddresses.has(value);
}

function unbracketedHostname(hostname: string): string {
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isStoragePathKey(key: string): boolean {
    return pathKey.test(key) && !urlPrefixPathKey.test(key);
}

function tempRoots(options: FixtureScanOptions): readonly string[] {
    return options.testTempRoots ?? [tmpdir()];
}

function isTestTempPath(value: string, options: FixtureScanOptions): boolean {
    const candidate = resolve(value);
    return tempRoots(options).some(root => {
        const normalizedRoot = resolve(root);
        return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${sep}`);
    });
}

function commonAbsolutePathValues(value: string): readonly string[] {
    const pattern = new RegExp(commonAbsolutePathPattern.source, `${commonAbsolutePathPattern.flags}g`);
    const paths: string[] = [];
    for (const match of value.matchAll(pattern)) {
        if (match.index === undefined) {
            continue;
        }
        const prefixOffset = match[0].search(/\/(?:data|home|media|mnt|opt|srv|var)\/|[a-z]:[\\/]/iu);
        if (prefixOffset === -1) {
            continue;
        }
        const fromStart = value.slice(match.index + prefixOffset);
        const absolutePath = /^(?:\/(?:data|home|media|mnt|opt|srv|var)\/|[a-z]:[\\/])[^\s"'<>`()[\]{},;]*/iu.exec(
            fromStart,
        )?.[0];
        if (absolutePath !== undefined) {
            paths.push(absolutePath);
        }
    }
    return paths;
}

function keyedFindings(
    value: string,
    location: string,
    key: string | undefined,
    context: readonly string[],
    options: FixtureScanOptions,
): FixtureFinding[] {
    if (key === undefined) {
        return [];
    }

    const normalizedKey = key.replace(/[-_]/gu, '');
    const parentKey = context.at(-2);

    if (
        (credentialKey.test(normalizedKey) || (key.toLowerCase() === 'key' && parentKey?.toLowerCase() === 'https')) &&
        !isSynthetic(value)
    ) {
        return [{ category: 'credential', location }];
    }

    if (
        (programKey.test(normalizedKey) ||
            (key.toLowerCase() === 'name' && parentKey !== undefined && /^programs?$/iu.test(parentKey))) &&
        !isSynthetic(value)
    ) {
        return [{ category: 'program-data', location }];
    }

    if (
        (tunerKey.test(normalizedKey) ||
            (key.toLowerCase() === 'name' && parentKey !== undefined && /^tuners?$/iu.test(parentKey))) &&
        !isSynthetic(value)
    ) {
        return [{ category: 'tuner-data', location }];
    }

    const isRecordedPath =
        key.toLowerCase() === 'path' && context.some(segment => segment.toLowerCase() === 'recorded');
    if ((isStoragePathKey(key) || isRecordedPath) && isAbsolute(value) && !isTestTempPath(value, options)) {
        return [{ category: 'absolute-storage-path', location }];
    }

    return [];
}

function stringFindings(
    value: string,
    location: string,
    key: string | undefined,
    context: readonly string[],
    options: FixtureScanOptions,
): FixtureFinding[] {
    const findings: FixtureFinding[] = [];

    for (const match of value.matchAll(urlPattern)) {
        // The URL parser tolerates a `${...}` placeholder inside userinfo or host by
        // percent-encoding it rather than throwing, so credential and allowed-host detection must
        // stay on the *whole* match -- exactly the base behavior. Deriving either from only the
        // truncated (pre-`${`) prefix is unsound: a placeholder can sit in the middle of a
        // loopback-looking host, with a real external authority -- userinfo, host, or both --
        // spliced away after it, and the whole match still parses successfully and reveals that
        // real authority. The one case genuinely unreachable this way is a template that replaces
        // the *port* on an otherwise fully static host -- the actual G6 shape -- because the
        // digits-only port grammar makes the whole match fail to parse even though everything
        // before the port is static and known-safe. That one case is handled below, from the
        // truncated prefix, but only when the placeholder cannot be hiding a spliced-away
        // authority: the prefix's authority must already be closed before the first `${`
        // (immediately after a port-separating `:`, or already past `/`/`?`/`#`), and no `@` may
        // appear in the discarded tail -- a `@` already inside the kept prefix is not spliced and
        // is unaffected by this gate.
        const url = parseUrl(match[0]);
        if (url?.username || url?.password) {
            findings.push({ category: 'credential', location });
        }

        const templateStart = match[0].indexOf('${');
        let truncatedUrl: URL | undefined;
        let authorityClosedBeforeTemplate = false;
        if (templateStart !== -1) {
            const prefix = match[0].slice(0, templateStart);
            const authorityIndex = prefix.indexOf('://');
            const afterAuthority = authorityIndex === -1 ? '' : prefix.slice(authorityIndex + 3);
            authorityClosedBeforeTemplate = prefix.endsWith(':') || /[/?#]/u.test(afterAuthority);
            if (authorityClosedBeforeTemplate) {
                truncatedUrl = parseUrl(prefix);
            }
        }

        if (truncatedUrl?.username || truncatedUrl?.password) {
            findings.push({ category: 'credential', location });
        }

        const discardedTail = templateStart === -1 ? '' : match[0].slice(templateStart);
        const isAllowedTemplateHost =
            authorityClosedBeforeTemplate &&
            !discardedTail.includes('@') &&
            truncatedUrl !== undefined &&
            isNonIdentifyingAddress(unbracketedHostname(truncatedUrl.hostname.toLowerCase()));

        if ((url === undefined || !isAllowedUrl(url)) && !isAllowedTemplateHost) {
            findings.push({ category: 'url', location });
        }
    }

    for (const match of value.matchAll(ipAddressPattern)) {
        if (isIpv4Address(match[0]) && !isNonIdentifyingAddress(match[0])) {
            findings.push({ category: 'ip-address', location });
        }
    }

    for (const match of value.matchAll(ipv6Pattern)) {
        if (isIP(match[0]) === 6 && !isNonIdentifyingAddress(match[0])) {
            findings.push({ category: 'ip-address', location });
        }
    }

    if (credentialPattern.test(value)) {
        findings.push({ category: 'credential', location });
    }

    const keyed = keyedFindings(value, location, key, context, options);
    const hasKeyedPathFinding = keyed.some(finding => finding.category === 'absolute-storage-path');
    // Whole-file content is not one path: `resolve` of the entire text can collapse `..` plus a
    // later temp-root segment and suppress a real `/mnt/` (or similar) match in the same file.
    if (
        !hasKeyedPathFinding &&
        commonAbsolutePathValues(value).some(absolutePath => !isTestTempPath(absolutePath, options))
    ) {
        findings.push({ category: 'absolute-storage-path', location });
    }

    findings.push(...keyed);
    return findings;
}

function sourceFindings(content: string, location: string, options: FixtureScanOptions): FixtureFinding[] {
    const findings = stringFindings(content, location, undefined, [], options);

    for (const match of content.matchAll(sensitiveSourceLiteralPattern)) {
        const key = match[1] ?? match[2];
        findings.push(...keyedFindings(match[4], location, key, [], options));
    }

    if (sourceFilePattern.test(location)) {
        findings.push(...sourceLiteralFindings(content, location, options));
    }

    return uniqueFindings(findings);
}

function sourceScriptKind(location: string): ts.ScriptKind {
    if (/\.tsx$/iu.test(location)) {
        return ts.ScriptKind.TSX;
    }
    if (/\.jsx$/iu.test(location)) {
        return ts.ScriptKind.JSX;
    }
    if (/\.[cm]?js$/iu.test(location)) {
        return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
}

function sourcePropertyName(
    name: ts.PropertyName,
    constants: ReadonlyMap<string, ts.Expression>,
    resolving: ReadonlySet<string> = new Set(),
): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    if (ts.isComputedPropertyName(name)) {
        const value = sourceLiteral(name.expression, constants, resolving);
        if (typeof value === 'string' || typeof value === 'number') {
            return String(value);
        }
    }
    return undefined;
}

function objectFreezeSourceArgument(expression: ts.Expression): ts.Expression | undefined {
    if (
        !ts.isCallExpression(expression) ||
        expression.arguments.length !== 1 ||
        !ts.isPropertyAccessExpression(expression.expression) ||
        expression.expression.name.text !== 'freeze' ||
        !ts.isIdentifier(expression.expression.expression) ||
        expression.expression.expression.text !== 'Object'
    ) {
        return undefined;
    }
    return expression.arguments[0];
}

function knownMockCallableResult(expression: ts.Expression | undefined): ts.Expression | undefined {
    if (
        expression === undefined ||
        !ts.isCallExpression(expression) ||
        expression.arguments.length !== 1 ||
        !ts.isPropertyAccessExpression(expression.expression) ||
        expression.expression.name.text !== 'mockResolvedValue'
    ) {
        return undefined;
    }

    const mockFactoryCall = expression.expression.expression;
    if (
        !ts.isCallExpression(mockFactoryCall) ||
        mockFactoryCall.arguments.length !== 0 ||
        !ts.isPropertyAccessExpression(mockFactoryCall.expression) ||
        mockFactoryCall.expression.name.text !== 'fn' ||
        !ts.isIdentifier(mockFactoryCall.expression.expression) ||
        mockFactoryCall.expression.expression.text !== 'vi'
    ) {
        return undefined;
    }
    return expression.arguments[0];
}

function bindingContainsIdentifier(binding: ts.BindingName, name: string): boolean {
    if (ts.isIdentifier(binding)) {
        return binding.text === name;
    }
    return binding.elements.some(
        element => !ts.isOmittedExpression(element) && bindingContainsIdentifier(element.name, name),
    );
}

function lexicalConstInitializer(reference: ts.Node, name: string): ts.Expression | undefined {
    const referencePosition = reference.getStart();
    let current: ts.Node | undefined = reference.parent;
    while (current !== undefined) {
        if (
            ts.isFunctionLike(current) &&
            current.parameters.some(({ name: binding }) => bindingContainsIdentifier(binding, name))
        ) {
            return undefined;
        }
        if (ts.isBlock(current) || ts.isSourceFile(current)) {
            let initializer: ts.Expression | undefined;
            let found = false;
            for (const statement of current.statements) {
                if (!ts.isVariableStatement(statement)) {
                    continue;
                }
                for (const declaration of statement.declarationList.declarations) {
                    if (!bindingContainsIdentifier(declaration.name, name)) {
                        continue;
                    }
                    if (
                        found ||
                        (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
                        !ts.isIdentifier(declaration.name) ||
                        declaration.initializer === undefined ||
                        declaration.getStart() >= referencePosition
                    ) {
                        return undefined;
                    }
                    found = true;
                    initializer = declaration.initializer;
                }
            }
            if (found) {
                return initializer;
            }
        }
        current = current.parent;
    }
    return undefined;
}

function shorthandMockCallableResult(property: ts.ShorthandPropertyAssignment): ts.Expression | undefined {
    if (!/^get[A-Z][A-Za-z\d]*FilePath$/u.test(property.name.text)) {
        return undefined;
    }
    return knownMockCallableResult(lexicalConstInitializer(property, property.name.text));
}

function sourceLiteral(
    expression: ts.Expression,
    constants: ReadonlyMap<string, ts.Expression>,
    resolving: ReadonlySet<string> = new Set(),
): SourceLiteralResult {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
        return sourceLiteral(expression.expression, constants, resolving);
    }
    const frozenArgument = objectFreezeSourceArgument(expression);
    if (frozenArgument !== undefined) {
        return sourceLiteral(frozenArgument, constants, resolving);
    }
    if (ts.isStringLiteral(expression)) {
        return expression.text;
    }
    if (ts.isNumericLiteral(expression)) {
        return Number(expression.text);
    }
    if (
        ts.isPrefixUnaryExpression(expression) &&
        (expression.operator === ts.SyntaxKind.MinusToken || expression.operator === ts.SyntaxKind.PlusToken) &&
        ts.isNumericLiteral(expression.operand)
    ) {
        const magnitude = Number(expression.operand.text);
        return expression.operator === ts.SyntaxKind.MinusToken ? -magnitude : magnitude;
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
    }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) {
        return false;
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) {
        return null;
    }
    if (ts.isIdentifier(expression)) {
        return referencedSourceLiteral(expression.text, constants, resolving);
    }
    if (ts.isArrayLiteralExpression(expression)) {
        return sourceArrayLiteral(expression, constants, resolving);
    }
    if (ts.isObjectLiteralExpression(expression)) {
        return sourceObjectLiteral(expression, constants, resolving);
    }
    return unresolvedSourceLiteral;
}

function referencedSourceLiteral(
    name: string,
    constants: ReadonlyMap<string, ts.Expression>,
    resolving: ReadonlySet<string>,
): SourceLiteralResult {
    const initializer = constants.get(name);
    if (initializer === undefined || resolving.has(name)) {
        return unresolvedSourceLiteral;
    }

    return sourceLiteral(initializer, constants, new Set([...resolving, name]));
}

function sourceArrayLiteral(
    expression: ts.ArrayLiteralExpression,
    constants: ReadonlyMap<string, ts.Expression>,
    resolving: ReadonlySet<string>,
): SourceLiteralResult {
    const values: SourceLiteral[] = [];
    for (const element of expression.elements) {
        if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
            return unresolvedSourceLiteral;
        }
        const value = sourceLiteral(element, constants, resolving);
        if (value === unresolvedSourceLiteral) {
            return unresolvedSourceLiteral;
        }
        values.push(value);
    }
    return values;
}

function sourceObjectLiteral(
    expression: ts.ObjectLiteralExpression,
    constants: ReadonlyMap<string, ts.Expression>,
    resolving: ReadonlySet<string>,
): SourceLiteralResult {
    const value: Record<string, SourceLiteral> = {};
    for (const property of expression.properties) {
        const entry = sourcePropertyLiteral(property, constants, resolving);
        if (entry === unresolvedSourceLiteral) {
            return unresolvedSourceLiteral;
        }
        value[entry[0]] = entry[1];
    }
    return value;
}

type SourcePropertyResult = readonly [string, SourceLiteral] | typeof unresolvedSourceLiteral;

function sourcePropertyLiteral(
    property: ts.ObjectLiteralElementLike,
    constants: ReadonlyMap<string, ts.Expression>,
    resolving: ReadonlySet<string>,
): SourcePropertyResult {
    if (ts.isShorthandPropertyAssignment(property)) {
        const value = referencedSourceLiteral(property.name.text, constants, resolving);
        return value === unresolvedSourceLiteral ? value : [property.name.text, value];
    }
    if (!ts.isPropertyAssignment(property)) {
        return unresolvedSourceLiteral;
    }

    const name = sourcePropertyName(property.name, constants, resolving);
    if (name === undefined) {
        return unresolvedSourceLiteral;
    }
    const value = sourceLiteral(property.initializer, constants, resolving);
    return value === unresolvedSourceLiteral ? value : [name, value];
}

function sourceConstants(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
    const constants = new Map<string, ts.Expression>();
    const ambiguous = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isVariableDeclarationList(node.parent) &&
            (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined
        ) {
            if (constants.has(node.name.text)) {
                ambiguous.add(node.name.text);
            } else {
                constants.set(node.name.text, node.initializer);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const name of ambiguous) {
        constants.delete(name);
    }
    return constants;
}

interface SourceInitializer {
    readonly name?: string;
    readonly initializer: ts.Expression;
    readonly failClosedByName: boolean;
    readonly inspectUnresolved: boolean;
}

function isModuleExportsAssignment(node: ts.BinaryExpression): boolean {
    return (
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ts.isIdentifier(node.left.expression) &&
        node.left.expression.text === 'module' &&
        node.left.name.text === 'exports'
    );
}

function sourceInitializers(
    sourceFile: ts.SourceFile,
    constants: ReadonlyMap<string, ts.Expression>,
): readonly SourceInitializer[] {
    const initializers: SourceInitializer[] = [];
    const added = new Map<ts.Expression, number>();
    const add = (initializer: SourceInitializer): void => {
        const existingIndex = added.get(initializer.initializer);
        if (existingIndex !== undefined) {
            const existing = initializers[existingIndex];
            const name = existing.name ?? initializer.name;
            const failClosedByName = existing.failClosedByName || initializer.failClosedByName;
            const inspectUnresolved = existing.inspectUnresolved || initializer.inspectUnresolved;
            if (
                name !== existing.name ||
                failClosedByName !== existing.failClosedByName ||
                inspectUnresolved !== existing.inspectUnresolved
            ) {
                initializers[existingIndex] = { ...existing, name, failClosedByName, inspectUnresolved };
            }
            return;
        }
        added.set(initializer.initializer, initializers.length);
        initializers.push(initializer);
    };
    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isVariableDeclarationList(node.parent) &&
            (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined
        ) {
            const statement = node.parent.parent;
            add({
                name: node.name.text,
                initializer: node.initializer,
                failClosedByName: ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent),
                inspectUnresolved: true,
            });
        }
        if (ts.isPropertyDeclaration(node) && node.initializer !== undefined) {
            const name = sourcePropertyName(node.name, constants);
            if (name !== undefined) {
                add({ name, initializer: node.initializer, failClosedByName: true, inspectUnresolved: true });
            }
        }
        if (ts.isExportAssignment(node)) {
            add({
                initializer: node.expression,
                failClosedByName: false,
                inspectUnresolved: true,
            });
        }
        if (ts.isReturnStatement(node) && node.expression !== undefined) {
            add({
                initializer: node.expression,
                failClosedByName: false,
                inspectUnresolved: true,
            });
        }
        if (ts.isBinaryExpression(node) && isModuleExportsAssignment(node)) {
            add({
                initializer: node.right,
                failClosedByName: false,
                inspectUnresolved: true,
            });
        }
        if (ts.isObjectLiteralExpression(node)) {
            add({
                initializer: node,
                failClosedByName: false,
                inspectUnresolved: false,
            });
        }
        if (ts.isShorthandPropertyAssignment(node)) {
            const callableResult = shorthandMockCallableResult(node);
            if (callableResult !== undefined) {
                add({
                    name: node.name.text,
                    initializer: callableResult,
                    failClosedByName: true,
                    inspectUnresolved: true,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return initializers;
}

function directSensitiveSourceKey(key: string): boolean {
    const normalizedKey = key.replace(/[-_]/gu, '');
    return (
        credentialKey.test(normalizedKey) ||
        programKey.test(normalizedKey) ||
        tunerKey.test(normalizedKey) ||
        isStoragePathKey(key)
    );
}

// A path built from the process working directory plus relative literals is the shape the
// server tests use to reach their own source. `sourceLiteral` cannot evaluate a call, so a
// storage-path-shaped name over that call would fail closed as `uninspectable`; this is the
// single largest group of scan findings it removes.
//
// Deliberately narrow, because the fail-closed default is the safety property here:
//   - the callee must be exactly `resolve` or `join` (bare identifier or `path.`-qualified),
//   - the first argument must resolve, through `constants`, to a literal `process.cwd()` call,
//   - every remaining argument must be a string literal that is relative, contains no `..`
//     segment and no drive letter.
// `resolve()` returns its last absolute argument, so rejecting absolute literals is what keeps
// an absolute trailing segment uninspectable. A base that is anything else -- an env
// var, a parameter, another call -- also stays uninspectable. The result is not materialised
// into a value: a concrete absolute path would then be reported as `absolute-storage-path`,
// which is the same false positive one layer down.
const pathJoinCallees = new Set(['resolve', 'join']);

function isProcessCwdCall(expression: ts.Expression): boolean {
    return (
        ts.isCallExpression(expression) &&
        expression.arguments.length === 0 &&
        ts.isPropertyAccessExpression(expression.expression) &&
        ts.isIdentifier(expression.expression.expression) &&
        expression.expression.expression.text === 'process' &&
        expression.expression.name.text === 'cwd'
    );
}

function isRepositoryAnchoredBase(
    expression: ts.Expression,
    constants: ReadonlyMap<string, ts.Expression>,
    seen: ReadonlySet<string>,
): boolean {
    if (isProcessCwdCall(expression)) {
        return true;
    }
    // A base may itself be another anchored path: `resolve(workflowDirectory, 'imp')` where
    // `workflowDirectory` is `resolve(repoRoot, 'test/server/workflow-coordination')`. Chaining
    // is not a widening -- every hop re-checks that its own trailing arguments are relative, so
    // the whole chain stays under the working directory.
    if (repositoryAnchoredPathCall(expression, constants, seen)) {
        return true;
    }
    if (!ts.isIdentifier(expression) || seen.has(expression.text)) {
        return false;
    }
    const referenced = constants.get(expression.text);
    return (
        referenced !== undefined &&
        isRepositoryAnchoredBase(referenced, constants, new Set([...seen, expression.text]))
    );
}

function isRelativePathSegment(segment: string): boolean {
    return (
        segment.length !== 0 &&
        !segment.startsWith('/') &&
        !segment.startsWith('\\') &&
        !/^[a-z]:/iu.test(segment) &&
        !segment.split(/[\\/]/u).includes('..')
    );
}

function repositoryAnchoredPathCall(
    expression: ts.Expression,
    constants: ReadonlyMap<string, ts.Expression>,
    seen: ReadonlySet<string> = new Set(),
): boolean {
    if (!ts.isCallExpression(expression) || expression.arguments.length < 2) {
        return false;
    }
    const callee = expression.expression;
    const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
    if (calleeName === undefined || !pathJoinCallees.has(calleeName)) {
        return false;
    }
    const [base, ...rest] = expression.arguments;
    if (base === undefined || !isRepositoryAnchoredBase(base, constants, seen)) {
        return false;
    }
    return rest.every(argument => ts.isStringLiteral(argument) && isRelativePathSegment(argument.text));
}

// `fileURLToPath(new URL('<relative literal>', import.meta.url))` resolves against the module's own
// location, so what it produces is fixed by the repository layout and carries nothing machine
// specific. Child process の prelude を書く test が共有 harness の場所を求めるのにこの形を使う。
// `sourceLiteral` は call を評価できないため、directory を表す名前の上に置かれたこの式は
// fail-closed で `uninspectable` になっていた。
//
// Deliberately narrow, because the fail-closed default is the safety property here:
//   - the callee must be exactly `fileURLToPath` (bare identifier or `url.`-qualified),
//   - its single argument must be `new URL(<string literal>, import.meta.url)`,
//   - the literal must be relative and carry no URL scheme and no drive letter.
// A zero-parameter arrow whose body is exactly that call is accepted too, since a test normally
// exposes the directory through such a helper. A base that is anything else -- an env var, a
// parameter, another call -- stays uninspectable. The result is not materialised into a value:
// a concrete absolute path would then be reported as `absolute-storage-path`, which is the same
// false positive one layer down.
function isImportMetaUrl(expression: ts.Expression): boolean {
    return (
        ts.isPropertyAccessExpression(expression) &&
        ts.isMetaProperty(expression.expression) &&
        expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
        expression.name.text === 'url'
    );
}

function isModuleRelativeUrlLiteral(text: string): boolean {
    return (
        text.length !== 0 &&
        !text.startsWith('/') &&
        !text.startsWith('\\') &&
        !/^[a-z][a-z0-9+.-]*:/iu.test(text)
    );
}

function moduleAnchoredPathCall(expression: ts.Expression): boolean {
    if (ts.isArrowFunction(expression) && expression.parameters.length === 0 && !ts.isBlock(expression.body)) {
        return moduleAnchoredPathCall(expression.body);
    }
    if (!ts.isCallExpression(expression) || expression.arguments.length !== 1) {
        return false;
    }
    const callee = expression.expression;
    const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
    if (calleeName !== 'fileURLToPath') {
        return false;
    }
    const [argument] = expression.arguments;
    if (argument === undefined || !ts.isNewExpression(argument)) {
        return false;
    }
    const urlArguments = argument.arguments;
    return (
        ts.isIdentifier(argument.expression) &&
        argument.expression.text === 'URL' &&
        urlArguments !== undefined &&
        urlArguments.length === 2 &&
        ts.isStringLiteral(urlArguments[0]) &&
        isModuleRelativeUrlLiteral(urlArguments[0].text) &&
        isImportMetaUrl(urlArguments[1])
    );
}

function sensitiveSourceInitializer(
    name: string,
    expression: ts.Expression,
    constants: ReadonlyMap<string, ts.Expression>,
    context: readonly string[] = [],
    resolving: ReadonlySet<string> = new Set(),
): boolean {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
        return sensitiveSourceInitializer(name, expression.expression, constants, context, resolving);
    }
    const frozenArgument = objectFreezeSourceArgument(expression);
    if (frozenArgument !== undefined) {
        return sensitiveSourceInitializer(name, frozenArgument, constants, context, resolving);
    }
    if (ts.isIdentifier(expression)) {
        const initializer = constants.get(expression.text);
        if (initializer === undefined || resolving.has(expression.text)) {
            return false;
        }
        // A referenced const that fully resolves is inspected on its own terms: `sourceConstants` and
        // `sourceInitializers` accept const declarations under the same predicate and both recurse the
        // whole file with `forEachChild`, and every initializer the latter enumerates carries
        // `inspectUnresolved: true`, so anything reachable through `constants` is also handed to
        // `scanValue` at its own declaration. (`sourceConstants` additionally drops names declared more
        // than once, so this branch is only reached for a single unambiguous declaration.) Recursing
        // here as well only makes the *enclosing* unresolvable declaration inherit a sensitivity its
        // resolvable neighbour already reports directly, turning a spread or a call the scanner cannot
        // evaluate into an `uninspectable` finding for values it has in fact fully inspected.
        if (
            sourceLiteral(initializer, constants, new Set([...resolving, expression.text])) !==
            unresolvedSourceLiteral
        ) {
            return false;
        }
        return sensitiveSourceInitializer(
            expression.text,
            initializer,
            constants,
            context,
            new Set([...resolving, expression.text]),
        );
    }
    if (
        context.some(segment => segment.toLowerCase() === 'https' || segment.toLowerCase() === 'recorded') &&
        sourceLiteral(expression, constants, resolving) === unresolvedSourceLiteral
    ) {
        return true;
    }
    if (ts.isArrayLiteralExpression(expression)) {
        return expression.elements.some(element => {
            if (ts.isOmittedExpression(element)) {
                return false;
            }
            const child = ts.isSpreadElement(element) ? element.expression : element;
            return sensitiveSourceInitializer(name, child, constants, context, resolving);
        });
    }
    if (!ts.isObjectLiteralExpression(expression)) {
        return false;
    }

    const keys = expression.properties
        .map(property =>
            property.name === undefined ? undefined : sourcePropertyName(property.name, constants, resolving),
        )
        .filter((key): key is string => key !== undefined);
    if (keys.includes('name') && keys.includes('eventId') && keys.includes('serviceId')) {
        return true;
    }
    if (keys.includes('name') && keys.includes('index') && keys.includes('types')) {
        return true;
    }

    return expression.properties.some(property => sensitiveSourceProperty(property, constants, context, resolving));
}

function sensitiveSourceProperty(
    property: ts.ObjectLiteralElementLike,
    constants: ReadonlyMap<string, ts.Expression>,
    context: readonly string[],
    resolving: ReadonlySet<string>,
): boolean {
    if (ts.isSpreadAssignment(property)) {
        return sensitiveSourceInitializer('', property.expression, constants, context, resolving);
    }
    if (ts.isShorthandPropertyAssignment(property)) {
        if (shorthandMockCallableResult(property) !== undefined) {
            return false;
        }
        if (directSensitiveSourceKey(property.name.text)) {
            return true;
        }
        return sensitiveSourceInitializer(property.name.text, property.name, constants, context, resolving);
    }
    if (!ts.isPropertyAssignment(property)) {
        return false;
    }

    const key = sourcePropertyName(property.name, constants, resolving);
    if (key === undefined) {
        return (
            ts.isComputedPropertyName(property.name) &&
            context.some(segment => segment.toLowerCase() === 'https' || segment.toLowerCase() === 'recorded')
        );
    }
    const parentKey = context.at(-1)?.toLowerCase();
    const isRecordedPathKey =
        key.toLowerCase() === 'path' && context.some(segment => segment.toLowerCase() === 'recorded');
    // A path-shaped property (unlike credential/program/tuner-shaped ones) can be proven safe on
    // its own initializer without resolving the rest of the containing object: either it is a
    // path built from the process working directory -- directly, through a const, or through
    // another such call, the same anchoring a top-level initializer of this shape is already
    // exempted for -- or it is a literal that fully resolves to a relative string. An absolute
    // literal, a non-string, or anything the scanner cannot resolve still falls through to the
    // unconditional fail-closed below.
    if (isStoragePathKey(key) || isRecordedPathKey) {
        if (isRepositoryAnchoredBase(property.initializer, constants, resolving)) {
            return false;
        }
        const literal = sourceLiteral(property.initializer, constants, resolving);
        if (typeof literal === 'string' && !isAbsolute(literal)) {
            return false;
        }
    }
    if (directSensitiveSourceKey(key) || (key.toLowerCase() === 'key' && parentKey === 'https') || isRecordedPathKey) {
        return true;
    }
    return sensitiveSourceInitializer(key, property.initializer, constants, [...context, key], resolving);
}

function sourceLiteralFindings(content: string, location: string, options: FixtureScanOptions): FixtureFinding[] {
    const sourceFile = ts.createSourceFile(location, content, ts.ScriptTarget.Latest, true, sourceScriptKind(location));
    const parseDiagnostics = (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
        .parseDiagnostics;
    if (parseDiagnostics !== undefined && parseDiagnostics.length !== 0) {
        return [{ category: 'uninspectable', location }];
    }

    const constants = sourceConstants(sourceFile);
    const findings: FixtureFinding[] = [];
    for (const { name, initializer, failClosedByName, inspectUnresolved } of sourceInitializers(
        sourceFile,
        constants,
    )) {
        const resolving = name === undefined ? new Set<string>() : new Set([name]);
        const value = sourceLiteral(initializer, constants, resolving);
        if (value === unresolvedSourceLiteral) {
            if (
                inspectUnresolved &&
                !repositoryAnchoredPathCall(initializer, constants) &&
                !moduleAnchoredPathCall(initializer) &&
                ((name !== undefined && failClosedByName && directSensitiveSourceKey(name)) ||
                    sensitiveSourceInitializer(name ?? '', initializer, constants, [], resolving))
            ) {
                findings.push({ category: 'uninspectable', location });
            }
            continue;
        }
        findings.push(...scanValue(value, location, name, name === undefined ? [] : [name], options));
    }
    return findings.map(finding => ({ ...finding, location }));
}

function uniqueFindings(findings: readonly FixtureFinding[]): FixtureFinding[] {
    const seen = new Set<string>();
    return findings.filter(finding => {
        const identity = `${finding.category}\u0000${finding.location}`;
        if (seen.has(identity)) {
            return false;
        }
        seen.add(identity);
        return true;
    });
}

function valueContext(value: Record<string, unknown>): string | undefined {
    if (typeof value.name === 'string' && typeof value.eventId === 'number' && typeof value.serviceId === 'number') {
        return 'program';
    }

    if (typeof value.name === 'string' && typeof value.index === 'number' && Array.isArray(value.types)) {
        return 'tuner';
    }

    return undefined;
}

function scanValue(
    value: unknown,
    location: string,
    key: string | undefined,
    context: readonly string[],
    options: FixtureScanOptions,
): FixtureFinding[] {
    if (typeof value === 'string') {
        return stringFindings(value, location, key, context, options);
    }

    if (Array.isArray(value)) {
        return value.flatMap((item, index) => scanValue(item, `${location}[${index}]`, undefined, context, options));
    }

    if (value === null || typeof value !== 'object') {
        return [];
    }

    const detectedContext = valueContext(value as Record<string, unknown>);
    const objectContext = detectedContext === undefined ? context : [...context, detectedContext];
    return Object.entries(value).flatMap(([childKey, childValue]) =>
        scanValue(childValue, `${location}.${childKey}`, childKey, [...objectContext, childKey], options),
    );
}

export function scanFixtureValue(value: unknown, options: FixtureScanOptions = {}): FixtureFinding[] {
    return uniqueFindings(scanValue(value, '$', undefined, [], options));
}

async function scanFile(root: string, filePath: string, options: FixtureScanOptions): Promise<FixtureFinding[]> {
    const location = relative(root, filePath).split(sep).join('/');
    let content: string;
    try {
        const bytes = await readFile(filePath);
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return [{ category: 'uninspectable', location }];
    }

    if (filePath.endsWith('.json')) {
        try {
            return uniqueFindings(scanValue(JSON.parse(content) as unknown, location, undefined, [], options));
        } catch {
            return sourceFindings(content, location, options);
        }
    }

    return sourceFindings(content, location, options);
}

async function scanDirectory(
    scanRoot: string,
    currentDirectory: string,
    options: FixtureScanOptions = {},
): Promise<FixtureFinding[]> {
    const findings: FixtureFinding[] = [];
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => {
        if (left.name < right.name) {
            return -1;
        }
        return left.name > right.name ? 1 : 0;
    })) {
        if (entry.name === 'node_modules' && (entry.isDirectory() || entry.isSymbolicLink())) {
            continue;
        }
        if (entry.isDirectory() && entry.name === '.artifacts') {
            continue;
        }
        const entryPath = join(currentDirectory, entry.name);
        const location = relative(scanRoot, entryPath).split(sep).join('/');
        if (entry.isDirectory()) {
            findings.push(...(await scanDirectory(scanRoot, entryPath, options)));
        } else if (entry.isFile()) {
            findings.push(...(await scanFile(scanRoot, entryPath, options)));
        } else {
            findings.push({ category: 'uninspectable', location });
        }
    }

    return findings;
}

export async function scanFixtureTree(root: string, options: FixtureScanOptions = {}): Promise<FixtureFinding[]> {
    return uniqueFindings(await scanDirectory(root, root, options));
}

/** file 1 つの内容を走査する。`.json` は JSON として値を走査し、解析できない場合と他の file は text として走査する。 */
export function contentFindings(content: string, location: string, options: FixtureScanOptions): FixtureFinding[] {
    if (location.endsWith('.json')) {
        try {
            return uniqueFindings(scanValue(JSON.parse(content) as unknown, location, undefined, [], options));
        } catch {
            return sourceFindings(content, location, options);
        }
    }
    return sourceFindings(content, location, options);
}
