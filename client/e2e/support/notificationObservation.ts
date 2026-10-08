import { expect, type Page } from '@playwright/test'

/**
 * Asserts on what the shell announced, rather than on the snackbar showing it.
 *
 * The snackbar closes itself 1500 ms after it opens, so an assertion against `getByRole('alert')`
 * has to catch it while it is on screen. Over a real clock that is a race the test can lose, and it
 * did: a failing run recorded three separate alerts resolved before the wait ran out, with the page
 * otherwise in the state the row expected. Widening the wait does not help, because the thing being
 * waited for keeps going away.
 *
 * Freezing the page clock does not work either -- measured, not assumed. Holding it across the
 * action left the alert never appearing at all, because the work between the action and the
 * notification is itself timer-driven; holding it once an alert appeared froze whichever
 * notification came first, so a later, expected one never arrived.
 *
 * The shell records each announcement in a hidden element that outlives the snackbar, so this reads
 * that instead. There is no window to miss: the text stays after the snackbar closes, and the count
 * distinguishes a repeat of the same message from one that never arrived.
 */
export function announcedNotification(page: Page) {
  return page.getByTestId('shell-announced-notification')
}

/**
 * Waits for the shell to have announced text containing `expected`.
 *
 * Matched against every announcement the page has made, not just the most recent one. A row that
 * drives two of them -- adding a reserve and then updating it -- would otherwise read whichever the
 * shell happens to be holding when the assertion runs, and the record does not expire, so waiting
 * on a stale one never resolves. Reading the history removes the ordering question entirely.
 */
export async function expectAnnounced(
  page: Page,
  expected: string | RegExp,
  options: { timeout?: number } = {},
): Promise<void> {
  const pattern = typeof expected === 'string' ? new RegExp(escapeForContains(expected)) : expected
  await expect
    .poll(
      async () => {
        const raw = await announcedNotification(page).getAttribute('data-announced-history')
        const history: unknown = raw === null ? [] : JSON.parse(raw)
        return (Array.isArray(history) ? history : []).some(
          (entry) => typeof entry === 'string' && pattern.test(entry),
        )
      },
      options.timeout === undefined ? undefined : { timeout: options.timeout },
    )
    .toBe(true)
}

/** `toContainText` semantics for a value read from an attribute. */
function escapeForContains(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
