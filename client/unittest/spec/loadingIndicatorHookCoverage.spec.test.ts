import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findLoadingIndicatorFilesWithoutDeferredHook,
  listLoadingIndicatorTestIds,
  readSource,
} from './support/loadingIndicatorHookCoverageRules'
import { listTsxFiles } from './support/staticSourceListing'

// The anti-flicker hook (`useDeferredLoading`) is applied to the
// four screens that render a "読み込み中" indicator (`.kiro/specs/frontend-recorded/design.md`,
// `.kiro/specs/frontend-reserves/design.md`). Unlike the behavioral tests in
// `loadingIndicatorFlicker.spec.test.tsx`, which exercise the Recorded and Reserves screens by name (the Guide is exercised by
// `guide.loading.spec.test.tsx`),
// this audit reads every routed component under `src/` and keeps that coverage total going
// forward: a screen that renders a `data-testid="*-loading"` indicator -- the existing four, or
// a future fifth -- must go through the shared hook, or this fails.
describe('every "*-loading" indicator screen goes through useDeferredLoading', () => {
  const srcRoot = join(process.cwd(), 'src')
  const files = listTsxFiles(srcRoot)

  it('finds the four known loading-indicator screens (scope guard)', () => {
    // This does not merely assert "no findings" -- an emptied or wrongly-rooted `listTsxFiles`
    // would make that assertion pass for the wrong reason (nothing to check, rather than nothing
    // wrong). Pinning the four files this audit is known to see, plus a floor below the real
    // count.
    const filesWithLoadingTestId = files.filter(
      (file) => listLoadingIndicatorTestIds(readSource(file)).length > 0,
    )
    const relative = filesWithLoadingTestId.map((file) => file.slice(process.cwd().length + 1))

    expect(relative).toEqual(
      expect.arrayContaining([
        'src/features/recorded/RecordedPage.tsx',
        'src/features/reserves/ReservesPage.tsx',
        'src/features/reserves/ManualReservePage.tsx',
        'src/features/guide/components/GuideGridHost.tsx',
      ]),
    )
    expect(filesWithLoadingTestId.length).toBeGreaterThanOrEqual(4)
  })

  it('imports useDeferredLoading in every file that renders a "*-loading" indicator', () => {
    const findings = findLoadingIndicatorFilesWithoutDeferredHook(files)

    expect(findings).toEqual([])
  })
})
