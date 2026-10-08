import { readFileSync } from 'node:fs'

const LOADING_TESTID_PATTERN = /data-testid="([\w-]*-loading)"/g
const DEFERRED_LOADING_IMPORT_PATTERN = /from ['"]@\/shared\/useDeferredLoading['"]/

export function readSource(file: string): string {
  return readFileSync(file, 'utf8')
}

/**
 * Distinct `data-testid` values ending in `-loading` that `source` renders. This suffix is the
 * project's existing naming convention for a route-level "読み込み中" indicator (`recorded-loading`,
 * `reserves-loading`, `manual-reserve-loading`) -- it deliberately does not match other testids
 * that merely contain the word "loading" (e.g. `playback-loading-indicator`), which belong to a
 * differently-scoped wait state documented as out of scope for this rule.
 */
export function listLoadingIndicatorTestIds(source: string): string[] {
  const found = new Set<string>()

  for (const match of source.matchAll(LOADING_TESTID_PATTERN)) {
    found.add(match[1])
  }

  return [...found]
}

export function importsDeferredLoadingHook(source: string): boolean {
  return DEFERRED_LOADING_IMPORT_PATTERN.test(source)
}

export interface LoadingIndicatorHookFinding {
  file: string
  testIds: string[]
  message: string
}

/**
 * Any component that renders a `data-testid="*-loading"` indicator is, by that naming
 * convention, one of the screens the anti-flicker fix (`useDeferredLoading`; see
 * `.kiro/specs/frontend-recorded/design.md` and `.kiro/specs/frontend-reserves/design.md`)
 * applies to. Flags a file that has such a testid but never imports the hook -- whether an
 * existing screen had its hook call removed, or a new screen added the indicator without it.
 */
export function findLoadingIndicatorFilesWithoutDeferredHook(
  files: readonly string[],
): LoadingIndicatorHookFinding[] {
  return files.flatMap((file) => {
    const source = readSource(file)
    const testIds = listLoadingIndicatorTestIds(source)

    if (testIds.length === 0 || importsDeferredLoadingHook(source)) {
      return []
    }

    return [
      {
        file,
        testIds,
        message: `renders ${testIds.join(', ')} without importing useDeferredLoading`,
      },
    ]
  })
}
