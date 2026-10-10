import { mergeConfig } from 'vitest/config'
import base from './vite.config'

// mutation testing（stryker.client.config.mjs）専用の vitest 設定。通常の test 実行では使わない。
// sandbox（repository 外の file を読めない）では動かない次の 2 file を除く。
// - detail-metadata.spec.test.tsx: client の外にある file を読む。
// - dashboardItemRoutes.spec.test.tsx: client の外にある file を読む。
export default mergeConfig(base, {
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/visual/**',
      '**/detail-metadata.spec.test.tsx',
      '**/dashboardItemRoutes.spec.test.tsx',
    ],
  },
})
