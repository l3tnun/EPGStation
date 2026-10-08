import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

interface StrUtilModule {
    toDBStr: (str: string) => string;
    toHalf: (str: string) => string;
    toHalfRegExp: (str: string) => string;
    toDouble: (str: string) => string;
    deleteBrackets: (str: string) => string;
    replaceDirName: (str: string) => string;
    replaceFileName: (str: string) => string;
    replaceEnclosedCharacters: (str: string) => string;
}

async function loadStrUtil(): Promise<StrUtilModule> {
    const moduleUrl = pathToFileURL(join(compiledSnapshot!, 'util', 'StrUtil.js'));
    const { default: StrUtil } = (await import(moduleUrl.href)) as { default: StrUtilModule };
    return StrUtil;
}

describe('[IMP-CHAR-SF-4] StrUtil DB string conversion', () => {
    it('removes PostgreSQL-incompatible NUL bytes', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toDBStr('abc\x00def\x00')).toBe('abcdef');
    });

    it('is the identity for a string without NUL bytes', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toDBStr('番組名')).toBe('番組名');
    });
});

describe('[IMP-CHAR-SF-4] StrUtil half/full width conversion', () => {
    it('converts full-width alphanumerics and punctuation to half-width', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toHalf('Ａ１　〜”’‘￥')).toBe('A1 ~"\'`\\');
    });

    it('converts half-width alphanumerics to full-width, keeping brackets half-width', async () => {
        const StrUtil = await loadStrUtil();

        // `"` (U+0022) is inside the generic half->full shift range `[!-~]` and is converted to
        // the full-width quotation mark U+FF02 '＂' by that pass; the later
        // `.replace(/"/g, '”')` typographic-quote step never finds a half-width `"` left to match.
        expect(StrUtil.toDouble('[a] "b"')).toBe('[ａ]　＂ｂ＂');
    });

    it('converts a backslash to the full-width yen sign instead of the generic full-width shift', async () => {
        const StrUtil = await loadStrUtil();

        // `\` (U+005C) is also inside `[!-~]`, so without the dedicated `.replace(/\\/g, '￥')`
        // pass ahead of it, the generic shift would produce the full-width backslash U+FF3C '＼'
        // instead of the full-width yen sign U+FFE5 '￥'.
        expect(StrUtil.toDouble('a\\b')).toBe('ａ￥ｂ');
    });
});

describe('[IMP-CHAR-SF-4] StrUtil regular-expression keyword conversion', () => {
    it('converts full-width alphanumerics and the full-width space to half-width', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toHalfRegExp('ＡＢＣ　ａｂｃ０１２')).toBe('ABC abc012');
    });

    it('converts full-width symbols that are not regular-expression symbols without an escape', async () => {
        const StrUtil = await loadStrUtil();

        // ！ ＃ ＆ ＝ ＠ ／ ： ； ， － ＜ ＞ ％ ＿ ～ plus the symbols toHalf maps individually (” ’ ‘ 〜)
        expect(StrUtil.toHalfRegExp('！＃＆＝＠／：；，－＜＞％＿～”’‘〜')).toBe('!#&=@/:;,-<>%_~"\'`~');
    });

    it.each([
        ['＼', '\\\\'],
        ['＾', '\\^'],
        ['＄', '\\$'],
        ['．', '\\.'],
        ['｜', '\\|'],
        ['？', '\\?'],
        ['＊', '\\*'],
        ['＋', '\\+'],
        ['（', '\\('],
        ['）', '\\)'],
        ['［', '\\['],
        ['］', '\\]'],
        ['｛', '\\{'],
        ['｝', '\\}'],
        ['￥', '\\\\'],
    ])('escapes the full-width %s so that it matches the half-width character itself', async (fullWidth, expected) => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toHalfRegExp(fullWidth)).toBe(expected);
    });

    it('keeps half-width regular-expression symbols as they are', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toHalfRegExp('^a.+b?|(c)[d]{1,2}$\\d*')).toBe('^a.+b?|(c)[d]{1,2}$\\d*');
    });

    it('converts a mixed keyword per character: full-width escaped, half-width untouched', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toHalfRegExp('なぜ？')).toBe('なぜ\\?');
        expect(StrUtil.toHalfRegExp('（再）')).toBe('\\(再\\)');
        expect(StrUtil.toHalfRegExp('^ＡＢ.＊(Ｃ|d)$')).toBe('^AB.\\*(C|d)$');
    });

    it('returns the empty string for the empty string', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.toHalfRegExp('')).toBe('');
    });
});

describe('[IMP-CHAR-SF-4] StrUtil filename normalization', () => {
    it('replaces every Windows-forbidden directory-name character', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.replaceDirName(':*?"<>|.')).toBe('：＊？”＜＞｜．');
    });

    it('replaces directory-forbidden characters plus path separators for file names', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.replaceFileName('a/b\\c')).toBe('a／b￥c');
    });

    it('removes bracketed segments and enclosed-character glyphs, then trims', async () => {
        const StrUtil = await loadStrUtil();

        // `\u{1f211}` is a raw enclosed-character glyph (not ASCII `[...]` bracket notation); only the
        // enclosedCharactersConvertTable removal loop strips it. `[HV]` is ASCII bracket notation,
        // stripped by the later `/\[.+?\]/g` regex. Exercising both together fails if either is removed.
        expect(StrUtil.deleteBrackets('  \u{1f211}番組名[HV]  ')).toBe('番組名');
    });

    it('round-trips a known enclosed-character glyph through bracket notation', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.replaceEnclosedCharacters('\u{1f14c}番組')).toBe('[SD]番組');
    });
});

describe('[IMP-CHAR-SF-4][SF-3.5] StrUtil.deleteBrackets duplicate-recording key', () => {
    // The duplicate-recording check compares the result of this function for a program with that of a
    // recorded history row, so the two halves of a split broadcast must stay distinguishable.
    it('appends the first-half marker at the end wherever it appears in the name', async () => {
        const StrUtil = await loadStrUtil();

        for (const name of [
            '[前]AAAA[字]',
            'AAAA[前][字]',
            '\u{1f21c}AAAA\u{1f211}',
            'AAAA\u{1f21c}\u{1f211}',
            '[字]AA\u{1f21c}AA',
            'AAAA[前]',
        ]) {
            expect(StrUtil.deleteBrackets(name), name).toBe('AAAA[前]');
        }
    });

    it('appends the second-half marker at the end wherever it appears in the name', async () => {
        const StrUtil = await loadStrUtil();

        for (const name of ['[後]AAAA[字]', 'AAAA[後][字]', '\u{1f21d}AAAA', 'AAAA\u{1f21d}[HV]', 'AAAA[後]']) {
            expect(StrUtil.deleteBrackets(name), name).toBe('AAAA[後]');
        }
    });

    it('keeps the first half, the second half and a name with neither apart', async () => {
        const StrUtil = await loadStrUtil();

        const keys = ['AAAA[前]', 'AAAA[後]', 'AAAA'].map(name => StrUtil.deleteBrackets(name));

        expect(new Set(keys).size).toBe(3);
        expect(keys).toEqual(['AAAA[前]', 'AAAA[後]', 'AAAA']);
    });

    it('orders both markers first-half then second-half regardless of their order in the name', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.deleteBrackets('AAAA[後][前]')).toBe('AAAA[前][後]');
        expect(StrUtil.deleteBrackets('\u{1f21d}AAAA\u{1f21c}')).toBe('AAAA[前][後]');
        expect(StrUtil.deleteBrackets('[前]AAAA[後]')).toBe('AAAA[前][後]');
    });

    it('removes the other markers, so a rerun or a subtitled broadcast matches the original', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.deleteBrackets('AAAA\u{1f21e}')).toBe('AAAA');
        expect(StrUtil.deleteBrackets('AAAA\u{1f211}')).toBe('AAAA');
        expect(StrUtil.deleteBrackets('AAAA[再]')).toBe('AAAA');
        expect(StrUtil.deleteBrackets('[字]AAAA[HV]')).toBe('AAAA');
        expect(StrUtil.deleteBrackets('\u{1f21f}\u{1f220}\u{1f221}AAAA')).toBe('AAAA');
    });

    it('leaves a name without a first-half or second-half marker as it was before', async () => {
        const StrUtil = await loadStrUtil();

        expect(StrUtil.deleteBrackets('  AAAA  ')).toBe('AAAA');
        expect(StrUtil.deleteBrackets('AAAA')).toBe('AAAA');
        expect(StrUtil.deleteBrackets('')).toBe('');
    });
});
