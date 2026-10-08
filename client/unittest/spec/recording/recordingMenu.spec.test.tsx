import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  createShellRepository,
  createRecordingRepository,
  findRecordingMenu,
} from './recordingTestKit'

// Chaining eight sequential recording-menu interactions (rule navigate, ruleId search, keyword
// search + rule-action absence, protect success, unprotect success, unprotect failure, protect
// failure, delete) across two synthetic recordings in one `it` would take long enough in real-clock
// time (~2.6-3.0s unloaded) to sit close to vitest's default per-test timeout, so contention from
// concurrent test files could tip it over. Each action is independent of the others (they operate
// on different synthetic recordings, or on independent mock outcomes, and only share fixture
// shape), so the coverage below is split one action-group per `it` with its own render; each AC
// tag maps onto the specific test that exercises it.

function renderRecordingPage(recordingRepository: ReturnType<typeof createRecordingRepository>) {
  return render(
    <App
      settings={new DefaultSettingsFactory().create()}
      apiRepository={createShellRepository()}
      recordedApiRepository={recordingRepository}
      recordingApiRepository={recordingRepository}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
}

describe('Recording menu actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recording?page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.21] rule action navigates to the rule search route after a short delay', async () => {
    const recordingRepository = createRecordingRepository()
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording one'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'rule' }))
    expect(window.location.hash).toBe('#/recording?page=3&timestamp=999')
    await waitFor(() => {
      expectHashRoute('#/search?rule=55')
    })
    await screen.findByRole('heading', { name: 'ルール編集' })
  })

  it('[AC 1.22] search action routes to /recorded?ruleId=<ruleId> when the item has a rule', async () => {
    const recordingRepository = createRecordingRepository()
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording one'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'search' }))
    expectHashRoute('#/recorded?ruleId=55')

    // The recorded page's (closed) search dialog reacts to the routed ruleId by fetching the
    // matching rule keyword in the background (RecordedSearchDialog's fetchRule effect). If
    // the test navigated away again before this settled, the dialog would unmount and discard the
    // pending update; since it does not, the update must be flushed inside act() instead of leaking
    // past the test boundary.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  it('[AC 1.21] [AC 1.22] hides the rule action and routes search to a keyword route when the item has no rule', async () => {
    const recordingRepository = createRecordingRepository()
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording two'))
    expect(screen.queryByRole('menuitem', { name: 'rule' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'search' }))
    expectHashRoute('#/recorded?keyword=Synthetic+recording+two')
  })

  it('[AC 1.23] protect action calls the API and shows a success snackbar', async () => {
    const recordingRepository = createRecordingRepository()
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording one'))
    vi.useFakeTimers()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'protect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護に成功')).toBeVisible()
    expect(recordingRepository.protectRecorded).toHaveBeenCalledWith(101)
  })

  it('[AC 1.23] unprotect action calls the API and shows a success snackbar', async () => {
    const recordingRepository = createRecordingRepository()
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording two'))
    vi.useFakeTimers()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'unprotect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護解除に成功')).toBeVisible()
    expect(recordingRepository.unprotectRecorded).toHaveBeenCalledWith(102)
  })

  it('[AC 1.23] unprotect action shows a failure snackbar when the API reports an error', async () => {
    const recordingRepository = createRecordingRepository()
    vi.mocked(recordingRepository.unprotectRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'unprotect-failed',
      message: '保護解除に失敗',
    })
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording two'))
    vi.useFakeTimers()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'unprotect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護解除に失敗')).toBeVisible()
  })

  it('[AC 1.23] protect action shows a failure snackbar when the API reports an error', async () => {
    const recordingRepository = createRecordingRepository()
    vi.mocked(recordingRepository.protectRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'protect-failed',
      message: '保護に失敗',
    })
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording one'))
    vi.useFakeTimers()
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'protect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護に失敗')).toBeVisible()
  })

  it('[AC 1.25] delete action opens the recorded delete dialog after a short delay', async () => {
    const recordingRepository = createRecordingRepository()
    renderRecordingPage(recordingRepository)

    fireEvent.click(await findRecordingMenu('Synthetic recording one'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'delete' }))
    expect(screen.queryByRole('dialog', { name: '録画削除' })).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: '録画削除' })).toBeVisible()
  })
})
