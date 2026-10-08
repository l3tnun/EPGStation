import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadProduction } from '../fixtures/reservation-rules/runtime';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

interface RuleOptionChecker {
    checkRuleOption(rule: unknown): boolean;
}

interface ChildResult {
    midnight: { count: number; endEpochs: number[]; startEpochs: number[] };
    monday: { count: number; endEpochs: number[]; startEpochs: number[] };
    overnight: { count: number; endEpochs: number[]; startEpochs: number[] };
    unlocks: number;
}

const ReserveOptionChecker = loadProduction<new (configuration: unknown) => RuleOptionChecker>(
    'model',
    'operator',
    'ReserveOptionChecker.js',
);

const runTimezoneChild = (timezone: string): Promise<ChildResult> =>
    new Promise((resolve, reject) => {
        const source = String.raw`
require('reflect-metadata');
const ReservationManageModel = require(process.argv[1]).default;
const fixedNow = Number(process.argv[2]);
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(value) { super(value === undefined ? fixedNow : value); }
  static now() { return fixedNow; }
};
const updates = [];
let unlocks = 0;
let ruleTime = { week: 0x7f, start: 0, range: 1 };
const model = new ReservationManageModel(
  { getLogger: () => ({ system: { debug() {}, error() {}, fatal() {}, info() {} } }) },
  { getConfig: () => ({ isSuppressReservesUpdateAllLog: false }) },
  { getExecution: async () => 'synthetic-execution', unLockExecution: () => { unlocks += 1; } },
  { checkEncodeOption: () => true },
  { findRuleId: async () => [], findTimeRanges: async () => [], updateMany: async diff => { updates.push(diff); } },
  { findId: async id => ({ id, channel: 'synthetic-channel', channelType: 'GR', name: 'synthetic' }) },
  { findRule: async () => [] },
  { findId: async () => ({
      id: 17,
      isTimeSpecification: true,
      searchOption: { keyword: 'synthetic-time', channelIds: [101], times: [ruleTime] },
      reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false },
    }) },
  { emitUpdated() {} },
);
(async () => {
  await model.updateRule(17);
  ruleTime = { week: 0x02, start: 10 * 60 * 60, range: 60 };
  await model.updateRule(17);
  ruleTime = { week: 0x02, start: 23 * 60 * 60 + 59 * 60, range: 120 };
  await model.updateRule(17);
  const summarize = diff => ({
    count: diff.insert.length,
    endEpochs: diff.insert.map(candidate => candidate.endAt),
    startEpochs: diff.insert.map(candidate => candidate.startAt),
  });
  process.stdout.write(JSON.stringify({ midnight: summarize(updates[0]), monday: summarize(updates[1]), overnight: summarize(updates[2]), unlocks }));
})().catch(error => {
  process.stderr.write(String(error && error.stack || error));
  process.exitCode = 1;
});
`;
        const child = spawn(
            process.execPath,
            [
                '-e',
                source,
                join(compiledSnapshot, 'model', 'operator', 'reservation', 'ReservationManageModel.js'),
                String(Date.parse('2030-01-06T16:30:00Z')),
            ],
            { env: { ...process.env, TZ: timezone }, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => (stderr += chunk));
        child.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timeout);
            child.removeAllListeners();
            if (code !== 0 || signal !== null || stderr !== '') {
                reject(new Error(`timezone child failed: code=${code} signal=${signal} stderr=${stderr}`));
                return;
            }
            resolve(JSON.parse(stdout) as ChildResult);
        });
    });

describe('process-local time rule expansion characterization', () => {
    it('[IMP-TIME-BOUNDARIES] fixes range-one, overnight, and local weekday epoch sequences', async () => {
        const utc = await runTimezoneChild('UTC');

        expect(utc.midnight).toEqual({
            count: 6,
            endEpochs: [8, 9, 10, 11, 12, 13].map(day =>
                Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:01+09:00`),
            ),
            startEpochs: [8, 9, 10, 11, 12, 13].map(day =>
                Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:00+09:00`),
            ),
        });
        expect(utc.monday).toEqual({
            count: 1,
            endEpochs: [Date.parse('2030-01-07T10:01:00+09:00')],
            startEpochs: [Date.parse('2030-01-07T10:00:00+09:00')],
        });
        expect(utc.overnight).toEqual({
            count: 1,
            endEpochs: [Date.parse('2030-01-08T00:01:00+09:00')],
            startEpochs: [Date.parse('2030-01-07T23:59:00+09:00')],
        });

        const outOfRange = new ReserveOptionChecker({ getConfig: () => ({ encode: [{ name: 'synthetic' }] }) });
        const baseTimeRule = (times: unknown[]) => ({
            isTimeSpecification: true,
            reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
            searchOption: { channelIds: [101], keyword: 'synthetic', times },
        });
        expect(outOfRange.checkRuleOption(baseTimeRule([{ week: 0x02, start: -1, range: 1 }]))).toBe(false);
        expect(outOfRange.checkRuleOption(baseTimeRule([{ week: 0x02, start: 0, range: 0 }]))).toBe(false);
        expect(utc.unlocks).toBe(3);
    });

    it('[IMP-TIMEZONE-CALENDAR] keeps UTC and Los Angeles weekday candidates distinct', async () => {
        const [utc, losAngeles] = await Promise.all([runTimezoneChild('UTC'), runTimezoneChild('America/Los_Angeles')]);

        expect(utc.monday.startEpochs).toEqual([Date.parse('2030-01-07T10:00:00+09:00')]);
        expect(losAngeles.monday.startEpochs).toEqual([Date.parse('2030-01-08T10:00:00+09:00')]);
        expect(utc.monday.startEpochs).not.toEqual(losAngeles.monday.startEpochs);
    });

    it('[CHAR-TIMEZONE-CALENDAR-SPLIT][RR-CHAR-5.5] observes production updateRule handoff across isolated timezones', async () => {
        const parentTimezone = process.env.TZ;
        const [tokyo, utc, losAngeles] = await Promise.all([
            runTimezoneChild('Asia/Tokyo'),
            runTimezoneChild('UTC'),
            runTimezoneChild('America/Los_Angeles'),
        ]);

        expect(tokyo).toEqual({
            midnight: {
                count: 7,
                endEpochs: [8, 9, 10, 11, 12, 13, 14].map(day =>
                    Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:01+09:00`),
                ),
                startEpochs: [8, 9, 10, 11, 12, 13, 14].map(day =>
                    Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:00+09:00`),
                ),
            },
            monday: {
                count: 2,
                endEpochs: [Date.parse('2030-01-07T10:01:00+09:00'), Date.parse('2030-01-14T10:01:00+09:00')],
                startEpochs: [Date.parse('2030-01-07T10:00:00+09:00'), Date.parse('2030-01-14T10:00:00+09:00')],
            },
            overnight: {
                count: 2,
                endEpochs: [Date.parse('2030-01-08T00:01:00+09:00'), Date.parse('2030-01-15T00:01:00+09:00')],
                startEpochs: [Date.parse('2030-01-07T23:59:00+09:00'), Date.parse('2030-01-14T23:59:00+09:00')],
            },
            unlocks: 3,
        });
        expect(utc).toEqual({
            midnight: {
                count: 6,
                endEpochs: [8, 9, 10, 11, 12, 13].map(day =>
                    Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:01+09:00`),
                ),
                startEpochs: [8, 9, 10, 11, 12, 13].map(day =>
                    Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:00+09:00`),
                ),
            },
            monday: {
                count: 1,
                endEpochs: [Date.parse('2030-01-07T10:01:00+09:00')],
                startEpochs: [Date.parse('2030-01-07T10:00:00+09:00')],
            },
            overnight: {
                count: 1,
                endEpochs: [Date.parse('2030-01-08T00:01:00+09:00')],
                startEpochs: [Date.parse('2030-01-07T23:59:00+09:00')],
            },
            unlocks: 3,
        });
        expect(losAngeles).toEqual({
            midnight: {
                count: 6,
                endEpochs: [8, 9, 10, 11, 12, 13].map(day =>
                    Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:01+09:00`),
                ),
                startEpochs: [8, 9, 10, 11, 12, 13].map(day =>
                    Date.parse(`2030-01-${String(day).padStart(2, '0')}T00:00:00+09:00`),
                ),
            },
            monday: {
                count: 1,
                endEpochs: [Date.parse('2030-01-08T10:01:00+09:00')],
                startEpochs: [Date.parse('2030-01-08T10:00:00+09:00')],
            },
            overnight: {
                count: 1,
                endEpochs: [Date.parse('2030-01-08T00:01:00+09:00')],
                startEpochs: [Date.parse('2030-01-07T23:59:00+09:00')],
            },
            unlocks: 3,
        });
        expect(process.env.TZ).toBe(parentTimezone);
    });
});
