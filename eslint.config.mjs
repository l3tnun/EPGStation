// ESLint 9 以降は flat config だけを読む。`.eslintrc.json` の内容をそのまま移したもので、
// 検査する対象も規則も変わらない。
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import epgstationTestRules, {
    serverCodeRules,
    serverEvalRules,
    serverFixtureRules,
    serverPlatformRules,
    serverVersionRules,
} from './tools/eslint-test-rules-server.mjs';
import textParser from './tools/eslint-text-parser.mjs';

const textExtensions = '{json,jsonc,md,toml,txt,yaml,yml,sql,pem}';

export default defineConfig([
    globalIgnores(['dist', 'client', 'node_modules', 'test/server/.artifacts']),
    {
        files: ['src/**/*.ts'],
        extends: [js.configs.recommended, tseslint.configs.recommended, prettier],
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2015,
            },
            parserOptions: {
                project: './tsconfig.json',
            },
        },
        rules: {
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-namespace': 'off',
            'no-constant-condition': 'off',
            'no-useless-escape': 'off',
            'no-async-promise-executor': 'off',
            'max-len': [
                'error',
                {
                    code: 180,
                    tabWidth: 4,
                    ignoreComments: true,
                    ignoreTrailingComments: true,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreRegExpLiterals: true,
                },
            ],
        },
    },
    // test の書き方の規則（.kiro/steering/server-testing.md「testを書く規則」の機械検出できるもの）。
    // 規則を eslint-disable で外させない。既存の directive が指す規則（import/*、no-throw-literal 等）はこの設定に無い。
    {
        files: ['test/server/**/*.{ts,mjs,cjs,js}', 'scripts/server-test/**/*.{mjs,cjs,js}'],
        extends: [tseslint.configs.base],
        linterOptions: { noInlineConfig: true },
        languageOptions: { sourceType: 'module' },
        plugins: { 'epgstation-test': epgstationTestRules },
        rules: serverVersionRules,
    },
    {
        files: ['test/server/**/*.cjs', 'scripts/server-test/**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
    },
    {
        // JavaScript でない file（json・yml・md・sql・pem など）は text のまま検査する。
        // 拡張子を並べるのは、`**/*` のような全件の pattern を ESLint が対象の file として数えないため。
        files: [
            `test/server/**/*.${textExtensions}`,
            `scripts/server-test/**/*.${textExtensions}`,
            'test/server/**/.{gitignore,npmignore,gitleaksignore}',
            'scripts/server-test/**/.{gitignore,npmignore,gitleaksignore}',
        ],
        linterOptions: { noInlineConfig: true },
        languageOptions: { parser: textParser },
        plugins: { 'epgstation-test': epgstationTestRules },
        rules: serverVersionRules,
    },
    {
        files: [
            'test/server/**/*.{ts,mjs,cjs,js}',
            `test/server/**/*.${textExtensions}`,
            'test/server/**/.{gitignore,npmignore,gitleaksignore}',
        ],
        plugins: { 'epgstation-test': epgstationTestRules },
        rules: serverFixtureRules,
    },
    {
        files: ['test/server/**/*.ts'],
        plugins: { 'epgstation-test': epgstationTestRules },
        rules: serverCodeRules,
    },
    {
        files: ['test/server/**/*.{ts,js,cjs}'],
        plugins: { 'epgstation-test': epgstationTestRules },
        rules: serverEvalRules,
    },
    {
        files: ['test/server/application-runtime/**/*.test.ts', 'test/server/tuner-access/**/*.test.ts'],
        plugins: { 'epgstation-test': epgstationTestRules },
        rules: serverPlatformRules,
    },
]);
