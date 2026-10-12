import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordedSearchDialog } from '@/features/recorded/components/RecordedSearchDialog'
import { createRecordedRepository } from './recordedSpecRepository'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RecordedSearchDialog remaining branches', () => {
  it('[AC 2.1] adds a fetched rule with a blank keyword fallback when it is missing from the list', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.fetchRule).mockResolvedValue({
      ok: true,
      value: { id: 99, keyword: undefined },
    })
    render(
      <RecordedSearchDialog
        anchorEl={document.body}
        search="?ruleId=99"
        apiRepository={apiRepository}
        isHalfWidthDisplayed
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onSnackbar={vi.fn()}
      />,
    )
    await waitFor(() => {
      expect(apiRepository.fetchRule).toHaveBeenCalledWith(99)
    })
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'ルール' })).toHaveValue('')
    })
  })

  it('[AC 2.3] re-fetches /rules/keyword as the user types, narrowing the rule options like v2', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.fetchRuleKeywords).mockImplementation(async (keyword) => {
      if (keyword === undefined) {
        return { ok: true, value: [{ id: 12, keyword: 'Synthetic rule' }] }
      }
      if (keyword === 'Foo') {
        return { ok: true, value: [{ id: 77, keyword: 'Foo narrowed rule' }] }
      }
      return { ok: true, value: [] }
    })
    const onNavigate = vi.fn()

    render(
      <RecordedSearchDialog
        anchorEl={document.body}
        search=""
        apiRepository={apiRepository}
        isHalfWidthDisplayed
        onClose={vi.fn()}
        onNavigate={onNavigate}
        onSnackbar={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(apiRepository.fetchRuleKeywords).toHaveBeenCalledWith()
    })
    const ruleField = screen.getByRole('combobox', { name: 'ルール' })
    fireEvent.change(ruleField, { target: { value: 'Foo' } })
    await waitFor(() => {
      expect(apiRepository.fetchRuleKeywords).toHaveBeenCalledWith('Foo')
    })
    expect(await screen.findByRole('option', { name: 'Foo narrowed rule' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Synthetic rule' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'Foo narrowed rule' }))
    expect(ruleField).toHaveValue('Foo narrowed rule')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'キーワード' }), { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('/recorded?ruleId=77')
  })

  it('[AC 2.3] ignores an input-driven rule fetch that resolves out of order', async () => {
    const apiRepository = createRecordedRepository()
    let resolveSlow: ((result: unknown) => void) | undefined
    let resolveFast: ((result: unknown) => void) | undefined
    vi.mocked(apiRepository.fetchRuleKeywords).mockImplementation((keyword) => {
      if (keyword === undefined) {
        return Promise.resolve({ ok: true, value: [{ id: 12, keyword: 'Synthetic rule' }] })
      }
      if (keyword === 'A') {
        return new Promise((resolve) => {
          resolveSlow = resolve as (result: unknown) => void
        }) as ReturnType<typeof apiRepository.fetchRuleKeywords>
      }
      return new Promise((resolve) => {
        resolveFast = resolve as (result: unknown) => void
      }) as ReturnType<typeof apiRepository.fetchRuleKeywords>
    })

    render(
      <RecordedSearchDialog
        anchorEl={document.body}
        search=""
        apiRepository={apiRepository}
        isHalfWidthDisplayed
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onSnackbar={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(apiRepository.fetchRuleKeywords).toHaveBeenCalledWith()
    })
    const ruleField = screen.getByRole('combobox', { name: 'ルール' })
    fireEvent.change(ruleField, { target: { value: 'A' } })
    await waitFor(() => {
      expect(apiRepository.fetchRuleKeywords).toHaveBeenCalledWith('A')
    })
    fireEvent.change(ruleField, { target: { value: 'AB' } })
    await waitFor(() => {
      expect(apiRepository.fetchRuleKeywords).toHaveBeenCalledWith('AB')
    })

    // The fast ("AB") request resolves first, then the stale ("A") request resolves later.
    resolveFast?.({ ok: true, value: [{ id: 88, keyword: 'AB rule' }] })
    await screen.findByRole('option', { name: 'AB rule' })
    resolveSlow?.({ ok: true, value: [{ id: 77, keyword: 'A rule' }] })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'AB rule' })).toBeVisible()
    })
    expect(screen.queryByRole('option', { name: 'A rule' })).not.toBeInTheDocument()
  })

  it('[AC 2.3] does not show a snackbar when an input-driven rule fetch fails, matching v2', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.fetchRuleKeywords).mockImplementation(async (keyword) => {
      if (keyword === undefined) {
        return { ok: true, value: [{ id: 12, keyword: 'Synthetic rule' }] }
      }
      return { ok: false, error: 'rule-keywords-failed', message: 'ignored' }
    })
    const onSnackbar = vi.fn()

    render(
      <RecordedSearchDialog
        anchorEl={document.body}
        search=""
        apiRepository={apiRepository}
        isHalfWidthDisplayed
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )

    await waitFor(() => {
      expect(apiRepository.fetchRuleKeywords).toHaveBeenCalledWith()
    })
    onSnackbar.mockClear()
    const ruleField = screen.getByRole('combobox', { name: 'ルール' })
    fireEvent.change(ruleField, { target: { value: 'Failing' } })
    await waitFor(() => {
      expect(apiRepository.fetchRuleKeywords).toHaveBeenCalledWith('Failing')
    })
    expect(onSnackbar).not.toHaveBeenCalled()
  })

  it('[AC 2.1] toggles the has-original-file checkbox', async () => {
    const apiRepository = createRecordedRepository()
    render(
      <RecordedSearchDialog
        anchorEl={document.body}
        search=""
        apiRepository={apiRepository}
        isHalfWidthDisplayed
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onSnackbar={vi.fn()}
      />,
    )
    await screen.findByRole('textbox', { name: 'キーワード' })
    const checkbox = screen.getByRole('checkbox', { name: '元ファイルを含む' })
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
  })
})
