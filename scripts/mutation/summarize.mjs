// Stryker の report（json）から、file ごとの件数と score、生き残りの一覧を出す。
//
// 使い方: node scripts/mutation/summarize.mjs <report.json> [<file の部分文字列>]
//   report は mutation:server・mutation:db が reports/mutation/{server,db}/report.json、
//   mutation:client が client/reports/mutation/report.json に出す。
//   第 2 引数を付けると、path にその文字列を含む file だけを出す。
//
// score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage)。
// CompileError・RuntimeError・Ignored は分母に入れない。
// 生き残りの一覧は docs/mutation-known-survivors.md と見比べて、載っていないものだけを扱う。

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SURVIVING = new Set(['Survived', 'NoCoverage']);
const REPLACEMENT_LIMIT = 80;

/**
 * @param {unknown} value
 * @returns {string}
 */
function oneLine(value) {
    const text = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > REPLACEMENT_LIMIT ? `${text.slice(0, REPLACEMENT_LIMIT)}...` : text;
}

/**
 * @param {string} reportPath
 * @param {string | undefined} filter
 * @returns {string[]}
 */
export function summarize(reportPath, filter) {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const rows = [];
    const details = [];

    for (const [file, data] of Object.entries(report.files ?? {})) {
        if (filter !== undefined && !file.includes(filter)) {
            continue;
        }

        const count = { Killed: 0, Survived: 0, NoCoverage: 0, Timeout: 0 };
        const survivors = [];
        for (const mutant of data.mutants) {
            if (mutant.status in count) {
                count[mutant.status] += 1;
            }
            if (SURVIVING.has(mutant.status)) {
                survivors.push(mutant);
            }
        }

        const valid = count.Killed + count.Timeout + count.Survived + count.NoCoverage;
        const score = valid === 0 ? 'n/a' : `${(((count.Killed + count.Timeout) / valid) * 100).toFixed(2)}%`;
        rows.push(
            [file, data.mutants.length, count.Killed, count.Survived, count.NoCoverage, count.Timeout, score].join(
                '\t',
            ),
        );

        const sourceLines = String(data.source ?? '').split('\n');
        survivors.sort((a, b) => a.location.start.line - b.location.start.line);
        details.push(`## ${file} (${survivors.length})`);
        for (const mutant of survivors) {
            const line = mutant.location.start.line;
            details.push(
                [
                    `${line}`,
                    mutant.status,
                    mutant.mutatorName,
                    mutant.static === true ? 'static' : '-',
                    oneLine(mutant.replacement),
                    (sourceLines[line - 1] ?? '').trim(),
                ].join('\t'),
            );
        }
    }

    return [
        '# file ごとの件数',
        ['file', 'mutants', 'Killed', 'Survived', 'NoCoverage', 'Timeout', 'score'].join('\t'),
        ...rows,
        '',
        '# 生き残り（Survived・NoCoverage）',
        ['行', '状態', 'mutator', 'static', '置き換え後', '元の行'].join('\t'),
        ...details,
    ];
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const [, , reportPath, filter] = process.argv;
    if (reportPath === undefined) {
        process.stderr.write('usage: node scripts/mutation/summarize.mjs <report.json> [<file の部分文字列>]\n');
        process.exit(2);
    }
    process.stdout.write(`${summarize(reportPath, filter).join('\n')}\n`);
}
