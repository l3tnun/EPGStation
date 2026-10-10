import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClearableInput } from '@/features/search/rule/components/ClearableInput'
import { RuleListRow } from '@/features/search/rule/components/RuleListRow'
import { RuleOptionField } from '@/features/search/rule/components/RuleOptionField'
import { RuleOptionForm } from '@/features/search/rule/components/RuleOptionForm'
import { SearchCheckbox } from '@/features/search/rule/components/SearchCheckbox'
import { SearchGenreRow } from '@/features/search/rule/components/SearchGenreRow'
import { SearchKeywordRows } from '@/features/search/rule/components/SearchKeywordRows'
import { SearchPeriodField } from '@/features/search/rule/components/SearchPeriodField'
import { SearchTimeRows } from '@/features/search/rule/components/SearchTimeRows'
import { TimeSpecifiedSearchForm } from '@/features/search/rule/components/TimeSpecifiedSearchForm'
import { READ_ONLY_RESERVES_API_REPOSITORY } from '@/features/search/rule/lib/readOnlyReservesRepository'
import {
  createDefaultSearchFormState,
  createDefaultSearchTimeReserveFormState,
} from '@/features/search/rule/query'
import type { SearchFormState, SearchRuleOptionDraft } from '@/features/search/rule/query'
import { chooseMuiSelectOption } from './searchRuleSupport'
import { fixCurrentDate, pickCalendarDay } from './shared/dateTimePickerTestKit'

function FormHarness({
  initial,
  children,
}: {
  initial?: Partial<SearchFormState>
  children: (props: {
    form: SearchFormState
    setForm: Dispatch<SetStateAction<SearchFormState>>
  }) => ReactNode
}) {
  const [form, setForm] = useState<SearchFormState>({
    ...createDefaultSearchFormState(['GR', 'BS']),
    ...initial,
  })
  return (
    <>
      {children({ form, setForm })}
      <pre data-testid="form">{JSON.stringify(form)}</pre>
    </>
  )
}

const readForm = () => JSON.parse(screen.getByTestId('form').textContent ?? '{}') as SearchFormState

const draft: SearchRuleOptionDraft = {
  reserveOption: {
    enable: true,
    allowEndLack: true,
    avoidDuplicate: false,
    periodToAvoidDuplicate: null,
  },
  saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
  encodeOption: {
    mode1: null,
    encodeParentDirectoryName1: null,
    directory1: null,
    mode2: 'm2',
    encodeParentDirectoryName2: null,
    directory2: null,
    mode3: null,
    encodeParentDirectoryName3: null,
    directory3: null,
    isDeleteOriginalAfterEncode: false,
  },
}

describe('search form leaf components', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.37] clearable input shows its clear button only when editable and non-empty', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ClearableInput ariaLabel="x" value="v" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'xをクリア' }))
    expect(onChange).toHaveBeenCalledWith('')
    fireEvent.change(screen.getByRole('textbox', { name: 'x' }), { target: { value: 'w' } })
    expect(onChange).toHaveBeenCalledWith('w')
    rerender(<ClearableInput ariaLabel="x" value="v" readOnly onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'xをクリア' })).toBeNull()
    rerender(<ClearableInput ariaLabel="x" value="v" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'x' }), { target: { value: 'z' } })
    expect(screen.queryByRole('button', { name: 'xをクリア' })).toBeNull()
  })

  it('[AC 2.27] checkbox reports its checked state', () => {
    const onChange = vi.fn()
    render(<SearchCheckbox checked={false} label="c" onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'c' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('[AC 2.27][AC 2.37] rule option field renders a text input or a select with fallback and clear', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<RuleOptionField label="f" value="v" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'f' }), { target: { value: 'n' } })
    expect(onChange).toHaveBeenCalledWith('n')
    rerender(<RuleOptionField label="f" value="legacy" options={['a']} onChange={onChange} />)
    await chooseMuiSelectOption('f', 'a')
    expect(onChange).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: 'fをクリア' }))
    expect(onChange).toHaveBeenCalledWith('')
    rerender(<RuleOptionField label="f" value="a" options={['a']} />)
    await chooseMuiSelectOption('f', 'a')
    rerender(<RuleOptionField label="f" value="v" />)
    expect(screen.getByRole('textbox', { name: 'f' })).toHaveAttribute('readonly')
  })

  it('[AC 2.27][AC 2.28] rule option form patches reserve, save and encode options', async () => {
    const onOptionDraftChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    const { rerender } = render(
      <RuleOptionForm
        buttonText="追加"
        encodeModes={['h264']}
        optionDraft={draft}
        recordedDirectories={['dir']}
        onOptionDraftChange={onOptionDraftChange}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '有効' }))
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ reserveOption: expect.objectContaining({ enable: false }) }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '状況に応じて末尾がかけることを許可' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '録画済み番組を排除' }))
    fireEvent.change(screen.getByRole('textbox', { name: '日数' }), { target: { value: '3' } })
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reserveOption: expect.objectContaining({ periodToAvoidDuplicate: 3 }),
      }),
    )
    await chooseMuiSelectOption('directory', 'dir')
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        saveOption: expect.objectContaining({ parentDirectoryName: 'dir' }),
      }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'sub directory' }), {
      target: { value: 'sub' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'file format' }), {
      target: { value: 'fmt' },
    })
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ saveOption: expect.objectContaining({ recordedFormat: 'fmt' }) }),
    )
    await chooseMuiSelectOption('mode1', 'h264')
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ encodeOption: expect.objectContaining({ mode1: 'h264' }) }),
    )
    await chooseMuiSelectOption('directory2', 'dir')
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        encodeOption: expect.objectContaining({ encodeParentDirectoryName2: 'dir' }),
      }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'sub directory3' }), {
      target: { value: 's3' },
    })
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ encodeOption: expect.objectContaining({ directory3: 's3' }) }),
    )
    await chooseMuiSelectOption('mode3', 'h264')
    await chooseMuiSelectOption('directory1', 'dir')
    await chooseMuiSelectOption('directory3', 'dir')
    fireEvent.change(screen.getByRole('textbox', { name: 'sub directory1' }), {
      target: { value: 's1' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'sub directory2' }), {
      target: { value: 's2' },
    })
    await chooseMuiSelectOption('mode2', 'h264')
    fireEvent.click(screen.getByRole('checkbox', { name: '元ファイルの自動削除' }))
    expect(onOptionDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        encodeOption: expect.objectContaining({ isDeleteOriginalAfterEncode: true }),
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(back).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onSubmit).toHaveBeenCalled()

    onOptionDraftChange.mockClear()
    rerender(
      <RuleOptionForm
        buttonText="更新"
        encodeModes={['h264']}
        optionDraft={{ reserveOption: draft.reserveOption, saveOption: draft.saveOption }}
        recordedDirectories={['dir']}
        onOptionDraftChange={onOptionDraftChange}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '元ファイルの自動削除' }))
    expect(onOptionDraftChange).not.toHaveBeenCalled()
  })

  it('[AC 2.19] rule option form hides encode panels when the server has no encode modes', () => {
    const onOptionDraftChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    render(
      <RuleOptionForm
        buttonText="追加"
        encodeModes={[]}
        optionDraft={{ reserveOption: draft.reserveOption, saveOption: draft.saveOption }}
        recordedDirectories={['dir']}
        onOptionDraftChange={onOptionDraftChange}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.queryByText('エンコード1')).toBeNull()
    expect(screen.queryByText('エンコード2')).toBeNull()
    expect(screen.queryByText('エンコード3')).toBeNull()
    expect(screen.queryByText('ファイル削除')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: '元ファイルの自動削除' })).toBeNull()
  })

  it('[AC 2.38] time-specified form updates keyword, channel, times and weekdays', async () => {
    function Harness() {
      const [form, setForm] = useState(createDefaultSearchTimeReserveFormState())
      return (
        <>
          <TimeSpecifiedSearchForm
            channelOptions={[{ id: 3, name: 'Three' }]}
            timeReserveForm={form}
            setTimeReserveForm={setForm}
          />
          <pre data-testid="form">{JSON.stringify(form)}</pre>
        </>
      )
    }
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: '番組名 keyword' }), {
      target: { value: 'k' },
    })
    await chooseMuiSelectOption('時刻指定 channel', 'Three')
    fireEvent.change(screen.getByRole('textbox', { name: '開始' }), { target: { value: '01:00' } })
    fireEvent.change(screen.getByRole('textbox', { name: '終了' }), { target: { value: '02:00' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '月' }))
    expect(JSON.parse(screen.getByTestId('form').textContent ?? '{}')).toMatchObject({
      keyword: 'k',
      channelId: 3,
      startTime: '01:00',
      endTime: '02:00',
      weekdays: expect.objectContaining({ mon: true }),
    })
    fireEvent.change(screen.getByRole('textbox', { name: '開始' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: '終了' }), { target: { value: '' } })
    expect(JSON.parse(screen.getByTestId('form').textContent ?? '{}')).toMatchObject({
      startTime: null,
      endTime: null,
    })
  })

  it('[AC 2.34] genre row selects genres, sub genres, hides sub genres and clears', async () => {
    function Harness() {
      const [visible, setVisible] = useState(true)
      return (
        <FormHarness initial={{ selectedGenres: [{ genre: 3, subGenre: 1 }] }}>
          {(props) => (
            <SearchGenreRow
              {...props}
              isSubGenreVisible={visible}
              setSubGenreVisible={setVisible}
            />
          )}
        </FormHarness>
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '国内ドラマ' }))
    expect(readForm().selectedGenres).toEqual([
      { genre: 3, subGenre: 0 },
      { genre: 3, subGenre: 1 },
    ])
    fireEvent.click(screen.getByRole('checkbox', { name: 'サブジャンル表示' }))
    expect(readForm().selectedGenres).toEqual([{ genre: 3 }])
    expect(screen.queryByRole('button', { name: '国内ドラマ' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'サブジャンル表示' }))
    fireEvent.click(screen.getByRole('button', { name: 'ドラマ' }))
    expect(readForm().selectedGenres).toEqual([])
    await chooseMuiSelectOption('genre', 'ドラマ')
    expect(readForm().genre).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: 'ドラマ' }))
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }))
    expect(readForm().selectedGenres).toEqual([])
  })

  it('[AC 2.12][AC 2.14] keyword rows submit on Enter and toggle targets, channels and waves', async () => {
    const submitSearch = vi.fn()
    function Harness() {
      const keywordRef = useRef('')
      const ignoreRef = useRef('')
      return (
        <FormHarness>
          {(props) => (
            <SearchKeywordRows
              {...props}
              enabledBroadcastWaves={['GR', 'BS']}
              channelSelectOptions={[{ id: 7, name: 'Seven' }]}
              keywordInputValueRef={keywordRef}
              ignoreKeywordInputValueRef={ignoreRef}
              submitSearch={submitSearch}
            />
          )}
        </FormHarness>
      )
    }
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: 'keyword' }), { target: { value: 'kw' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'keyword' }), { key: 'a' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'keyword' }), { key: 'Enter' })
    expect(submitSearch).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'kw' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'ignore keyword' }), {
      target: { value: 'ig' },
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ignore keyword' }), { key: 'a' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ignore keyword' }), { key: 'Enter' })
    expect(submitSearch).toHaveBeenLastCalledWith(expect.objectContaining({ ignoreKeyword: 'ig' }))
    const [nameBox, ignoreNameBox] = screen.getAllByRole('checkbox', { name: '名前' })
    fireEvent.click(nameBox!)
    fireEvent.click(ignoreNameBox!)
    fireEvent.click(screen.getByRole('checkbox', { name: 'GR' }))
    expect(readForm()).toMatchObject({
      keywordTargets: expect.objectContaining({ name: true }),
      ignoreKeywordTargets: expect.objectContaining({ name: true }),
      broadcastWaves: { GR: false, BS: true },
    })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'channelId' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Seven' }))
    await waitFor(() => expect(readForm().channelIds).toEqual([7]))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    const channelClearButton = screen.getByRole('button', { name: 'channelIdをクリア' })
    fireEvent.mouseDown(channelClearButton)
    fireEvent.click(channelClearButton)
    expect(readForm().channelIds).toEqual([])
  })

  it('[AC 2.12] treats a broadcast wave missing from the form state as unchecked', () => {
    function Harness() {
      return (
        <FormHarness>
          {(props) => (
            <SearchKeywordRows
              {...props}
              enabledBroadcastWaves={['GR', 'BS', 'CS']}
              channelSelectOptions={[]}
              keywordInputValueRef={{ current: '' }}
              ignoreKeywordInputValueRef={{ current: '' }}
              submitSearch={vi.fn()}
            />
          )}
        </FormHarness>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('checkbox', { name: 'CS' })).not.toBeChecked()
  })

  it('[AC 2.12][AC 2.14] renders and toggles a BS4K checkbox as a 5th broadcast wave', () => {
    function Harness() {
      return (
        <FormHarness
          initial={{ broadcastWaves: { GR: true, BS: true, CS: true, SKY: true, BS4K: true } }}
        >
          {(props) => (
            <SearchKeywordRows
              {...props}
              enabledBroadcastWaves={['GR', 'BS', 'CS', 'SKY', 'BS4K']}
              channelSelectOptions={[]}
              keywordInputValueRef={{ current: '' }}
              ignoreKeywordInputValueRef={{ current: '' }}
              submitSearch={vi.fn()}
            />
          )}
        </FormHarness>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('checkbox', { name: 'BS4K' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'BS4K' }))
    expect(readForm().broadcastWaves).toMatchObject({ BS4K: false })
  })

  it('[AC 2.12] shows the raw channel id when a selected channel is no longer in the option list', () => {
    function Harness() {
      return (
        <FormHarness initial={{ channelIds: [99] }}>
          {(props) => (
            <SearchKeywordRows
              {...props}
              enabledBroadcastWaves={['GR']}
              channelSelectOptions={[{ id: 7, name: 'Seven' }]}
              keywordInputValueRef={{ current: '' }}
              ignoreKeywordInputValueRef={{ current: '' }}
              submitSearch={vi.fn()}
            />
          )}
        </FormHarness>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('combobox', { name: 'channelId' })).toHaveTextContent('99')
  })

  it('[AC 2.30][AC 2.33] time rows set start, range, weekdays, durations, periods and actions', async () => {
    fixCurrentDate('2026-01-01T12:00:00+09:00')
    const onClear = vi.fn()
    const onSubmit = vi.fn()
    render(
      <FormHarness>
        {(props) => <SearchTimeRows {...props} onClear={onClear} onSubmit={onSubmit} />}
      </FormHarness>,
    )
    await chooseMuiSelectOption('start', '1時')
    await chooseMuiSelectOption('range', '2時間')
    expect(readForm()).toMatchObject({ startTime: 1, durationMinutes: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'startをクリア' }))
    fireEvent.click(screen.getByRole('button', { name: 'rangeをクリア' }))
    expect(readForm()).toMatchObject({ startTime: null, durationMinutes: null })
    fireEvent.click(screen.getByRole('checkbox', { name: '月' }))
    fireEvent.change(screen.getByRole('textbox', { name: '最小(分)' }), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '最大(分)' }), {
      target: { value: '9' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: '無料放送' }))
    expect(readForm()).toMatchObject({
      weekdays: expect.objectContaining({ mon: false }),
      durationMinMinutes: 5,
      durationMaxMinutes: 9,
      isFree: true,
    })
    fireEvent.click(screen.getByRole('textbox', { name: '開始' }))
    pickCalendarDay(await screen.findByRole('dialog', { name: '期間 開始' }), 2)
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await waitFor(() => expect(readForm().startPeriod).toBe(new Date('2026-01-02T00:00').getTime()))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('textbox', { name: '終了' }))
    fireEvent.click(await screen.findByRole('button', { name: 'クリア' }))
    await waitFor(() => expect(readForm().endPeriod).toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }))
    expect(onClear).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '検索' }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('[AC 2.30] period field clears from the text field and starts every dialog from the current value', async () => {
    const onChange = vi.fn()
    render(
      <SearchPeriodField
        label="開始"
        value={new Date('2026-01-02T03:04').getTime()}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '開始をクリア' }))
    expect(onChange).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole('textbox', { name: '開始' }))
    const dialog = await screen.findByRole('dialog', { name: '期間 開始' })
    expect(within(dialog).getByRole('gridcell', { name: '2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    pickCalendarDay(dialog, 9)
    fireEvent.click(within(dialog).getByRole('button', { name: 'クリア' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('textbox', { name: '開始' }))
    const reopened = await screen.findByRole('dialog', { name: '期間 開始' })
    expect(within(reopened).getByRole('gridcell', { name: '2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(within(reopened).getByRole('button', { name: '設定' }))
    expect(onChange).toHaveBeenLastCalledWith(new Date('2026-01-02T03:04').getTime())
  })

  it('[AC 3.16] rule list row toggles selection only in edit mode', () => {
    const onToggleSelection = vi.fn()
    const rule = {
      id: 1,
      searchOption: { times: [] },
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
    }
    const { rerender } = render(
      <RuleListRow
        rule={rule}
        isEnabled
        isEditMode={false}
        isSelected={false}
        onToggleEnable={() => undefined}
        onToggleSelection={onToggleSelection}
        onOpenMenu={() => undefined}
      />,
    )
    fireEvent.click(screen.getAllByText('-')[0]!)
    expect(onToggleSelection).not.toHaveBeenCalled()
    rerender(
      <RuleListRow
        rule={rule}
        isEnabled
        isEditMode
        isSelected
        onToggleEnable={() => undefined}
        onToggleSelection={onToggleSelection}
        onOpenMenu={() => undefined}
      />,
    )
    fireEvent.click(screen.getAllByText('-')[0]!)
    expect(onToggleSelection).toHaveBeenCalled()
  })

  it('[AC 2.26] read-only reserves repository refuses every mutation and fetch', async () => {
    const repository = READ_ONLY_RESERVES_API_REPOSITORY
    const results = await Promise.all([
      repository.fetchReserves({} as never),
      repository.fetchManualReserve(1 as never),
      repository.fetchManualProgram(1 as never),
      repository.addManualReserve({} as never),
      repository.updateManualReserve(1 as never, {} as never),
      repository.deleteReserve(1),
      repository.unlockSkipReserve(1),
      repository.unlockOverlapReserve(1),
      repository.updateReserves(),
    ])
    expect(results.every((result) => !result.ok)).toBe(true)
  })
})
