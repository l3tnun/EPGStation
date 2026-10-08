import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join, posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
// Windows の drive 付き path は、文字と `:` を別の値にして組み立てる（保存先らしい絶対 path の literal を file に書かない）。
const winDrive = 'C:';
const util = require(join(snapshot, 'util', 'SubDirectoryUtil.js')) as {
    INVALID_SUB_DIRECTORY_ERROR: string;
    hasSubDirectoryOutsideRoot(saveOption?: Record<string, unknown>, encodeOption?: Record<string, unknown>): boolean;
    isSubDirectoryInsideRoot(subDirectory: string, platformPath?: typeof posix | typeof win32): boolean;
    stripLeadingSeparators(relativePath: string, platformPath?: Pick<typeof posix, 'sep'>): string;
};

const rooted = (relative: string): string => `/${relative}`;

/**
 * 保存先内ディレクトリが保存先 root の中に収まるかの共通の判定。
 * 録画ファイルを作る `path.join(root, directory)` と、削除が登録 path から先頭の区切りを取り除く解釈に合わせる。
 */
describe('sub directory containment (unittest/imp)', () => {
    it.each([
        '',
        '.',
        '/',
        '//',
        'anime',
        '/anime',
        '//anime',
        '/anime/',
        'a/b',
        '/a/b',
        'a/../b',
        '/a/../b',
        '/./a',
        'a/..',
        '..foo',
        '/..foo',
        'a..',
        'a/./b',
        '%TITLE%/%YEAR%',
    ])('[RE-3.19] accepts %j on posix, which stays inside the root', directory => {
        expect(util.isSubDirectoryInsideRoot(directory, posix)).toBe(true);
    });

    it.each([
        '..',
        '../x',
        '/..',
        '/../x',
        '//..//x',
        'a/../../x',
        '/a/../../x',
        './../x',
        '../',
        'a/b/../../..',
        'nul\0dir',
        '\0',
        '/\0',
    ])('[RE-3.19] rejects %j on posix, which leaves the root or contains NUL', directory => {
        expect(util.isSubDirectoryInsideRoot(directory, posix)).toBe(false);
    });

    it.each(['\\anime', '/anime', 'a\\..\\b', '\\\\server\\share'])(
        '[RE-3.19] accepts %j on win32, where leading separators are stripped before resolving',
        directory => {
            expect(util.isSubDirectoryInsideRoot(directory, win32)).toBe(true);
        },
    );

    it.each([
        '..',
        '..\\x',
        '\\..\\x',
        '/../x',
        'a\\..\\..\\x',
        `${winDrive}\\x`,
        `${winDrive}\\`,
        'C:x',
        'C:',
        'C:..',
        'C:..\\x',
        '\\C:x',
        'nul\0dir',
    ])('[RE-3.19] rejects %j on win32, which leaves the root, is absolute, or contains NUL', directory => {
        expect(util.isSubDirectoryInsideRoot(directory, win32)).toBe(false);
    });

    it.each(['C:x', 'C:', 'C:..', 'a/C:x'])(
        '[RE-3.19] accepts %j on posix, where a drive letter is an ordinary name',
        directory => {
            expect(util.isSubDirectoryInsideRoot(directory, posix)).toBe(true);
        },
    );

    it('[RE-3.19] defaults to the running platform', () => {
        expect(util.isSubDirectoryInsideRoot('a/../b')).toBe(true);
        expect(util.isSubDirectoryInsideRoot('../b')).toBe(false);
    });

    it('[RC-8.10] strips only leading separators and the platform separator set decides which', () => {
        expect(util.stripLeadingSeparators('//anime/x.ts', posix)).toBe('anime/x.ts');
        expect(util.stripLeadingSeparators('\\anime', posix)).toBe('\\anime');
        expect(util.stripLeadingSeparators('\\/anime', win32)).toBe('anime');
        expect(util.stripLeadingSeparators('anime/', win32)).toBe('anime/');
        expect(util.stripLeadingSeparators('/anime')).toBe('anime');
    });

    it('[RR-4.3] reports an outside directory in the save option or in any of the three encode options', () => {
        expect(util.INVALID_SUB_DIRECTORY_ERROR).toBe('InvalidSubDirectory');
        expect(util.hasSubDirectoryOutsideRoot()).toBe(false);
        expect(util.hasSubDirectoryOutsideRoot({}, {})).toBe(false);
        expect(util.hasSubDirectoryOutsideRoot({ directory: 'a/../b' }, { directory1: '/anime' })).toBe(false);
        expect(util.hasSubDirectoryOutsideRoot({ parentDirectoryName: 'p' }, { mode1: 'm' })).toBe(false);
        expect(util.hasSubDirectoryOutsideRoot({ directory: '../x' })).toBe(true);
        expect(util.hasSubDirectoryOutsideRoot({ directory: rooted('../x') }, undefined)).toBe(true);
        expect(util.hasSubDirectoryOutsideRoot(undefined, { directory1: '../x' })).toBe(true);
        expect(util.hasSubDirectoryOutsideRoot(undefined, { directory2: 'a/../../x' })).toBe(true);
        expect(util.hasSubDirectoryOutsideRoot(undefined, { directory3: 'nul\0dir' })).toBe(true);
    });
});
