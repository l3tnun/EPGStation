import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { oldRecorded, oldRule, v1Backup } from './_harness';

/*
 * v1 のバックアップ（手書きの fixture）が、v1 のバックアップ形式の型（src/v1.d.ts の OldBackupData）と同じ項目を
 * 持つことを確かめる。型に必須の項目が fixture に無い、型に無い項目が fixture にある、のどちらも許さない。
 */

const declarationPath = join(process.cwd(), 'src', 'v1.d.ts');

const readInterfaces = (): Map<string, { readonly required: string[]; readonly all: string[] }> => {
    const source = ts.createSourceFile(
        declarationPath,
        readFileSync(declarationPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const interfaces = new Map<string, { required: string[]; all: string[] }>();
    for (const statement of source.statements) {
        if (!ts.isInterfaceDeclaration(statement)) continue;
        const entry = { all: [] as string[], required: [] as string[] };
        for (const member of statement.members) {
            if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
            entry.all.push(member.name.text);
            if (member.questionToken === undefined) entry.required.push(member.name.text);
        }
        interfaces.set(statement.name.text, entry);
    }
    return interfaces;
};

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('v1 backup fixtures against the v1 backup format type', () => {
    const interfaces = readInterfaces();
    const shape = (name: string) => {
        const entry = interfaces.get(name);
        if (entry === undefined) throw new Error(`${name} is not declared in v1.d.ts`);
        return entry;
    };
    const cases: Array<[string, string, Record<string, unknown>]> = [
        ['OldRuleItem', 'rules', oldRule()],
        ['OldRecordedItem', 'recorded', oldRecorded()],
        ['OldEncodedItem', 'encoded', v1Backup().encoded[0]],
        ['OldRecordedHistoryItem', 'recordedHistory', v1Backup().recordedHistory[0]],
    ];

    it.each(cases)(
        '[V1-FIXTURE-PARITY] %s fixture carries every required item and no item outside the type',
        (name, _key, fixture) => {
            const { all, required } = shape(name);
            const keys = Object.keys(fixture);
            expect(sorted(required.filter(key => !keys.includes(key)))).toEqual([]);
            expect(sorted(keys.filter(key => !all.includes(key)))).toEqual([]);
        },
    );

    it('[V1-FIXTURE-PARITY] the backup envelope carries exactly the items of OldBackupData', () => {
        expect(sorted(Object.keys(v1Backup()))).toEqual(sorted(shape('OldBackupData').required));
        expect(sorted(Object.keys(v1Backup().dbRevisionInfo))).toEqual(sorted(shape('DBRevisionInfo').required));
    });
});
