// `.json`・`.yml`・`.md` など JavaScript でない file を、中身を text のまま規則へ渡すための parser。
// 空の Program を返し、規則は `context.sourceCode.text` を読む。
export default {
    meta: { name: 'epgstation-text-parser' },
    parseForESLint(code) {
        const lines = code.split('\n');
        return {
            ast: {
                type: 'Program',
                body: [],
                comments: [],
                tokens: [],
                sourceType: 'module',
                range: [0, code.length],
                loc: {
                    start: { line: 1, column: 0 },
                    end: { line: lines.length, column: lines[lines.length - 1].length },
                },
            },
            visitorKeys: { Program: [] },
        };
    },
};
