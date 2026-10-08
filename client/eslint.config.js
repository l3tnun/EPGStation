import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import epgstationTestRules, {
  clientCoverageExclusionRules,
  clientTestRules,
} from '../tools/eslint-test-rules-client.mjs'

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    'public/serviceWorker.js',
  ]),
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
  },
  {
    // test の書き方の規則（.kiro/steering/testing.md「test を書くときの規則」の機械検出できるもの）。
    files: ['unittest/spec/**/*.test.{ts,tsx}'],
    plugins: { 'epgstation-test': epgstationTestRules },
    rules: clientTestRules,
  },
  {
    // coverage の除外（`v8 ignore`）を狭く、理由付きに保つ規則。
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.d.ts', 'src/**/__fixtures__/**', 'src/**/__mocks__/**', 'src/**/test/**'],
    plugins: { 'epgstation-test': epgstationTestRules },
    rules: clientCoverageExclusionRules,
  },
])
