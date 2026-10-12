// tools/eslint-test-rules-*.mjs が共有する、ESTree の小さな補助。依存 package を import しない
// （client の eslint 設定がこの file を経由して読めるように）。

export const calleeName = callee => {
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        return callee.property.name;
    }
    return undefined;
};

export const keyName = node => {
    if (node.computed) return undefined;
    if (node.key.type === 'Identifier') return node.key.name;
    if (node.key.type === 'Literal') return String(node.key.value);
    return undefined;
};

export const memberName = node => {
    if (!node.computed && node.property.type === 'Identifier') return node.property.name;
    if (node.computed && node.property.type === 'Literal') return String(node.property.value);
    return undefined;
};

export const isProcessIdentifier = node => node?.type === 'Identifier' && node.name === 'process';
