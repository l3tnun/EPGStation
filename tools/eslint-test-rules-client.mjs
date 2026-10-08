// client の test と coverage 除外の書き方のうち、構文から機械的に判定できる規則。
// client/eslint.config.js が `client/unittest/spec` の test と `client/src` に適用する。
// 規則の一覧と範囲・例外は .kiro/steering/testing.md「testを書くときの規則」にある。
// この file は依存 package を import しない（client の `node_modules` だけで eslint の設定を読めるようにする）。
import { calleeName, keyName } from './eslint-rule-utils.mjs';

const FAKE_TIMER_ENABLE = 'useFakeTimers';
const FAKE_TIMER_RESTORE = 'useRealTimers';
const isTestCall = node =>
    (node.callee.type === 'Identifier' && ['it', 'test'].includes(node.callee.name)) ||
    (node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        ['it', 'test'].includes(node.callee.object.name));

// `waitFor(`（`vi.waitFor(` を含む）、`await findBy*(`、`await screen.findBy*(`。
const isRealTimePoll = node => {
    if (calleeName(node.callee) === 'waitFor') return true;
    const awaited = node.parent.type === 'AwaitExpression';
    const { callee } = node;
    if (callee.type === 'Identifier') return awaited && /^findBy/u.test(callee.name);
    return (
        awaited &&
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'screen' &&
        callee.property.type === 'Identifier' &&
        /^findBy/u.test(callee.property.name)
    );
};

const noRealTimePollUnderFakeTimers = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            poll: 'fake timer が有効な間に `waitFor`・`findBy*` を使わない（実時間で poll するので test の timeout まで止まる）。clock を明示的に進める。',
        },
    },
    create(context) {
        let faked = false;
        return {
            CallExpression(node) {
                // 各 test の先頭で fake timer の状態を戻す。afterEach の復元は test より前に書かれるため、file 全体では判定できない。
                if (isTestCall(node)) faked = false;
                const name = calleeName(node.callee);
                if (name === FAKE_TIMER_ENABLE) faked = true;
                else if (name === FAKE_TIMER_RESTORE) faked = false;
                else if (faked && isRealTimePoll(node)) context.report({ node, messageId: 'poll' });
            },
        };
    },
};

const CLOSING_SURFACE_ATTRIBUTE = 'data-controls-visible';

const noClosingSurfaceWithoutFakeTimers = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            closing:
                '一定時間で閉じる surface（snackbar の `alert`、player の `data-controls-visible`）を待って検証する file は fake timer を有効にして、clock を進めて観測する。',
        },
    },
    create(context) {
        let usesFakeTimers = false;
        const candidates = [];
        // 行頭が `expect(` の行は、surface の状態を同期的に読むだけなので対象にしない。
        const add = node => {
            if (!/^\s*expect\(/u.test(context.sourceCode.lines[node.loc.start.line - 1] ?? '')) candidates.push(node);
        };
        return {
            CallExpression(node) {
                const name = calleeName(node.callee);
                if (name === FAKE_TIMER_ENABLE) usesFakeTimers = true;
                // 引数が `'alert'` だけの呼出し（`getByRole('alert', { ... })` は対象外）。
                if (
                    ['getByRole', 'findByRole', 'queryAllByRole'].includes(name) &&
                    node.arguments.length === 1 &&
                    node.arguments[0].type === 'Literal' &&
                    node.arguments[0].value === 'alert'
                ) {
                    add(node);
                }
            },
            Literal(node) {
                if (typeof node.value === 'string' && node.value.includes(CLOSING_SURFACE_ATTRIBUTE)) add(node);
            },
            TemplateElement(node) {
                if (node.value.raw.includes(CLOSING_SURFACE_ATTRIBUTE)) add(node);
            },
            JSXIdentifier(node) {
                if (node.name === CLOSING_SURFACE_ATTRIBUTE) add(node);
            },
            'Program:exit'() {
                if (usesFakeTimers) return;
                for (const node of candidates) context.report({ node, messageId: 'closing' });
            },
        };
    },
};

// `setTimeout(resolve, N)`・`setTimeout(() => resolve(), N)` で N が 0 以外。
const isResolveCallback = node =>
    (node?.type === 'Identifier' && node.name === 'resolve') ||
    (node?.type === 'ArrowFunctionExpression' &&
        node.params.length === 0 &&
        node.body.type === 'CallExpression' &&
        node.body.callee.type === 'Identifier' &&
        node.body.callee.name === 'resolve' &&
        node.body.arguments.length === 0);

const noRealTimeSleep = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            sleep: '固定時間の実時間を待たない（`setTimeout(resolve, N)`）。待つ対象を待つか、test が進める clock を使う。待ち時間 0 は可。',
        },
    },
    create(context) {
        return {
            CallExpression(node) {
                if (calleeName(node.callee) !== 'setTimeout') return;
                if (!isResolveCallback(node.arguments[0])) return;
                const delay = node.arguments[1];
                if (delay?.type === 'Literal' && typeof delay.value === 'number' && delay.value !== 0) {
                    context.report({ node, messageId: 'sleep' });
                }
            },
        };
    },
};

// 数値で始まる式（`5`、`2 * 1000`）。
const startsWithNumber = node => {
    let current = node;
    while (current.type === 'BinaryExpression') current = current.left;
    return current.type === 'Literal' && typeof current.value === 'number';
};

const requireTimeoutComment = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            timeout: '明示的な待ち時間（`timeout: <数値>`）には、その時間が覆う実装側の遅延を書いた `//` comment を直前 4 行以内に付ける。通すために延ばさない。',
        },
    },
    create(context) {
        return {
            Property(node) {
                // key の末尾が `timeout`（`connect_timeout` を含む）で、値が数値で始まる。
                if (!keyName(node)?.endsWith('timeout') || !startsWithNumber(node.value)) return;
                const line = node.loc.start.line;
                const commented = context.sourceCode
                    .getAllComments()
                    .some(comment => comment.type === 'Line' && comment.loc.start.line >= line - 4 && comment.loc.start.line < line);
                if (!commented) context.report({ node, messageId: 'timeout' });
            },
        };
    },
};

// coverage の除外（`v8 ignore`）は、jsdom で意味のある検証ができない category に限り、狭く、理由付きにする。
export const V8_LIMITS = Object.freeze({
    nextLines: 5,
    rangeLines: 12,
    ignoredLinesPerFile: 20,
    ignoredRatioPerFile: 0.15,
});
const V8_MARKER = /^\s*v8 ignore\s+(start|stop|next|file|if|else)(?:\s+(\d+))?\s*(?:--\s*([^*]*?))?\s*$/u;
const V8_REASON_CATEGORY =
    /layout|portal|media|HTMLMediaElement|hls|mpegts|MSE|TextTrack|fullscreen|orientation|pointer|geometry|service worker|socket\.io|jsdom|navigator|ResizeObserver|IntersectionObserver|visualViewport|requestAnimationFrame|clipboard/iu;

const narrowCoverageExclusion = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            malformed: '`v8 ignore` の書式が不正。`/* v8 ignore next|start|stop [行数] -- 理由 */` の形にする。',
            kind: '`v8 ignore {{kind}}` は使わない。除外は `next` か `start`/`stop` の狭い範囲にする。',
            reason: '`v8 ignore` には `--` に続けて、jsdom で検証できない category（layout・portal・media・fullscreen・pointer・service worker・socket.io など）を含む理由を書く。',
            nextTooWide: '`v8 ignore next` は {{max}} 行以内にする（{{count}} 行）。',
            rangeTooWide: '`v8 ignore start` から `stop` までは {{max}} 行以内にする（{{count}} 行）。',
            unpaired: '`v8 ignore start`・`stop` が対応していない。',
            fileTooMany: 'この file の `v8 ignore` の除外行が多すぎる（{{count}} 行。上限は {{max}} 行、{{minimum}} 行を超えるなら file の {{ratio}}% 以内）。除外でなく責務を分けて test する。',
        },
    },
    create(context) {
        const { sourceCode } = context;
        // 母数は file を `\n` で分けた行数。
        const totalLines = sourceCode.text.split('\n').length;
        let ignoredLines = 0;
        let openStart;
        return {
            Program() {
                for (const comment of sourceCode.getAllComments()) {
                    if (!/v8 ignore/u.test(comment.value)) continue;
                    const match = V8_MARKER.exec(comment.value);
                    // 複数行にわたる comment は、1 行で閉じた marker として読まれないので書式の違反にする。
                    if (comment.type !== 'Block' || comment.loc.start.line !== comment.loc.end.line || match === null) {
                        context.report({ loc: comment.loc, messageId: 'malformed' });
                        continue;
                    }
                    const [, kind, countText, reason] = match;
                    if (kind === 'file' || kind === 'if' || kind === 'else') {
                        context.report({ loc: comment.loc, messageId: 'kind', data: { kind } });
                        continue;
                    }
                    const reasonOk = reason !== undefined && V8_REASON_CATEGORY.test(reason);
                    if (kind === 'stop') {
                        if (openStart === undefined) {
                            context.report({ loc: comment.loc, messageId: 'unpaired' });
                            continue;
                        }
                        const count = comment.loc.start.line - openStart.start - 1;
                        if (count > V8_LIMITS.rangeLines) {
                            context.report({
                                loc: openStart.loc,
                                messageId: 'rangeTooWide',
                                data: { max: String(V8_LIMITS.rangeLines), count: String(count) },
                            });
                        }
                        if (!openStart.reasonOk) context.report({ loc: openStart.loc, messageId: 'reason' });
                        ignoredLines += Math.max(count, 0);
                        openStart = undefined;
                    } else if (kind === 'start') {
                        if (openStart !== undefined) context.report({ loc: comment.loc, messageId: 'unpaired' });
                        openStart = { start: comment.loc.start.line, loc: comment.loc, reasonOk };
                    } else {
                        const count = countText === undefined ? 1 : Number(countText);
                        if (count > V8_LIMITS.nextLines) {
                            context.report({
                                loc: comment.loc,
                                messageId: 'nextTooWide',
                                data: { max: String(V8_LIMITS.nextLines), count: String(count) },
                            });
                        }
                        if (!reasonOk) context.report({ loc: comment.loc, messageId: 'reason' });
                        ignoredLines += Math.min(count, Math.max(totalLines - comment.loc.start.line, 0));
                    }
                }
                if (openStart !== undefined) context.report({ loc: openStart.loc, messageId: 'unpaired' });
                if (
                    ignoredLines > V8_LIMITS.ignoredLinesPerFile ||
                    (ignoredLines > V8_LIMITS.nextLines && ignoredLines / totalLines > V8_LIMITS.ignoredRatioPerFile)
                ) {
                    context.report({
                        loc: { line: 1, column: 0 },
                        messageId: 'fileTooMany',
                        data: {
                            count: String(ignoredLines),
                            max: String(V8_LIMITS.ignoredLinesPerFile),
                            minimum: String(V8_LIMITS.nextLines),
                            ratio: String(V8_LIMITS.ignoredRatioPerFile * 100),
                        },
                    });
                }
            },
        };
    },
};

export default {
    rules: {
        'no-real-time-poll-under-fake-timers': noRealTimePollUnderFakeTimers,
        'no-closing-surface-without-fake-timers': noClosingSurfaceWithoutFakeTimers,
        'no-real-time-sleep': noRealTimeSleep,
        'require-timeout-comment': requireTimeoutComment,
        'narrow-coverage-exclusion': narrowCoverageExclusion,
    },
};

// client/unittest/spec に適用する規則。
export const clientTestRules = {
    'epgstation-test/no-real-time-poll-under-fake-timers': 'error',
    'epgstation-test/no-closing-surface-without-fake-timers': 'error',
    'epgstation-test/no-real-time-sleep': 'error',
    'epgstation-test/require-timeout-comment': 'error',
};

// client/src の coverage 除外に適用する規則。
export const clientCoverageExclusionRules = {
    'epgstation-test/narrow-coverage-exclusion': 'error',
};
