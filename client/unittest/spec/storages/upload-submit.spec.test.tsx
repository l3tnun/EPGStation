import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  changeSettingsSelect,
  createShellRepository,
  expectMuiSelectText,
} from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  createDeferred,
  uploadProgramNameInput,
  uploadVideoBlock,
  fillRequiredUploadFields,
  warmUpRecordedUploadAppRender,
} from './recordedUploadSpecSupport'

// Role and label queries compute every candidate's accessible name or label association with
// `getComputedStyle`, and jsdom recomputes style after each DOM change, so a query over the whole
// document (the app shell's navigation and title bar included) costs several times a query over the
// upload page itself. Everything this file looks up by role or label lives inside the page.
function uploadPage() {
  return within(screen.getByTestId('recorded-upload-page'))
}

describe('Recorded upload route and form state', () => {
  beforeAll(async () => {
    await warmUpRecordedUploadAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/upload')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Shared by the tests below so each proof independently reaches "form ready to submit". 'required'
  // fills only what a submit needs to pass validation and reach `createRecorded` at all (channel,
  // dates, name, and one fully valid video block). 'full' also fills the optional metadata (genre,
  // sub genre, rule, description, extended) and is used only by the test that asserts the whole
  // `createRecorded` body; the upload-order, skip and success tests assert only on what happens
  // after metadata resolves, so they do not pay for fields they never observe.
  //
  // Every plain text/file input is looked up once, up front, and the select/autocomplete
  // interactions then run on top of those same elements. The first query
  // after each DOM change costs tens of ms under coverage instrumentation (role and label queries
  // are the expensive ones), so interleaving "look up one input, change it" for every field is what
  // dominated this file's longest tests. The elements stay mounted across the selects, so the
  // events are delivered to exactly the inputs the user would be typing into.
  async function fillMetadataFields(
    recordedRepository: RecordedApiRepository,
    scope: 'required' | 'full' = 'required',
  ): Promise<File> {
    const firstFile = new File(['first'], 'main.ts', { type: 'video/mp2t' })
    const startInput = uploadPage().getByLabelText('開始')
    const lengthInput = uploadPage().getByLabelText('長さ(分)')
    const nameInput = uploadProgramNameInput()
    const descriptionInput = scope === 'full' ? uploadPage().getByLabelText('description') : null
    const extendedInput = scope === 'full' ? uploadPage().getByLabelText('extended') : null
    const blockNameInput = uploadVideoBlock(0).getByLabelText('name')
    const subDirectoryInput = uploadVideoBlock(0).getByLabelText('sub directory')
    const fileInput = uploadVideoBlock(0).getByLabelText('video file')
    const ruleInput =
      scope === 'full' ? uploadPage().getByRole('combobox', { name: 'ルール' }) : null

    fireEvent.change(startInput, { target: { value: '2026-05-05T12:30' } })
    fireEvent.change(lengthInput, { target: { value: '30' } })
    fireEvent.change(nameInput, { target: { value: 'Synthetic program' } })
    if (descriptionInput !== null) {
      fireEvent.change(descriptionInput, { target: { value: 'Synthetic summary' } })
    }
    if (extendedInput !== null) {
      fireEvent.change(extendedInput, { target: { value: 'Synthetic extended' } })
    }
    fireEvent.change(blockNameInput, { target: { value: 'Main upload' } })
    fireEvent.change(subDirectoryInput, { target: { value: 'season-one' } })
    fireEvent.change(fileInput, { target: { files: [firstFile] } })

    await changeSettingsSelect(/放送局※?/, /Synthetic .*channel/)
    await changeSettingsSelect(/file type/, 'ts', uploadVideoBlock(0))
    if (scope === 'full') {
      await changeSettingsSelect(/^genre/, 'Synthetic genre')
      await changeSettingsSelect(/^sub genre/, 'トークバラエティ')
      fireEvent.change(ruleInput as HTMLElement, { target: { value: 'Synthetic' } })
      await waitFor(() => {
        expect(recordedRepository.fetchRuleKeywords).toHaveBeenCalledWith('Synthetic')
      })
      fireEvent.click(await screen.findByRole('option', { name: 'Synthetic rule' }))
    }

    return firstFile
  }

  // Extends `fillMetadataFields` with a second validated video block, so the ordering test below
  // can prove the two uploads happen in the order the blocks were filled. Kept separate from
  // `fillIncompleteThirdBlock` below (which adds the still-empty third block on top of this) so the
  // ordering test does not also pay for filling a block it never asserts on -- that assertion
  // belongs entirely to the "silently skips" test, which is the only one that needs a third block
  // to skip in the first place.
  async function fillTwoValidatedVideoBlocks(
    recordedRepository: RecordedApiRepository,
  ): Promise<{ firstFile: File; secondFile: File; addVideoBlockButton: HTMLElement }> {
    const addVideoBlockButton = uploadPage().getByRole('button', { name: '動画ファイルを追加' })
    const firstFile = await fillMetadataFields(recordedRepository)
    fireEvent.click(addVideoBlockButton)
    const secondBlockNameInput = uploadVideoBlock(1).getByLabelText('name')
    const secondFileInput = uploadVideoBlock(1).getByLabelText('video file')
    fireEvent.change(secondBlockNameInput, { target: { value: 'Encoded upload' } })
    await changeSettingsSelect(/file type/, 'encoded', uploadVideoBlock(1))
    const secondFile = new File(['second'], 'encoded.mp4', { type: 'video/mp4' })
    fireEvent.change(secondFileInput, { target: { files: [secondFile] } })

    return { firstFile, secondFile, addVideoBlockButton }
  }

  // Adds a third, still-empty video block on top of `fillTwoValidatedVideoBlocks`, which the
  // "silently skips an incomplete block" test uses to trigger the AC 3.11 skip branch. Split out of
  // that helper (rather than folded into a single "full form" helper) so the two tests below each
  // only pay for the block-fill work their own assertion needs.
  async function fillIncompleteThirdBlock(
    recordedRepository: RecordedApiRepository,
  ): Promise<{ firstFile: File; secondFile: File }> {
    const { firstFile, secondFile, addVideoBlockButton } =
      await fillTwoValidatedVideoBlocks(recordedRepository)
    fireEvent.click(addVideoBlockButton)
    return { firstFile, secondFile }
  }

  // The full workflow (fill form, submit, resolve metadata, upload both videos, observe success) is
  // split into one test per phase, each with its own render and its own full form-fill, because a
  // single end-to-end test's real-clock duration -- dominated by the form-fill sequence and its own
  // `changeSettingsSelect` menu-close waits, repeated for every field -- is close to vitest's
  // default 5000ms per-test timeout before the video-upload and success-observation work is
  // added. Each test keeps its own phase's assertions and none carries another phase's unrelated
  // work on its critical path. AC tags are redistributed onto whichever test actually exercises
  // each contract: AC 3.1 and 3.9 are the dialog and the metadata request this test observes; the
  // sequencing half of AC 3.2 (video upload deferred until metadata resolves) is also this test's,
  // since it never resolves the metadata promise. AC 3.10 and AC 3.11 belong to the next two tests
  // below (themselves later split further apart, see the comment there), and AC 3.4 / 3.13 belong
  // to the test after those, all of which resolve metadata immediately instead.
  it('[AC 3.1] [AC 3.2] [AC 3.9] shows the upload dialog, sends recorded metadata once despite a double click, and defers video upload until it resolves', async () => {
    const recordedRepository = createRecordedRepository()
    const metadataResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['createRecorded']>>>()
    vi.mocked(recordedRepository.createRecorded).mockReturnValueOnce(metadataResult.promise)

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root', 'backup-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    await fillMetadataFields(recordedRepository, 'full')

    const uploadButton = uploadPage().getByRole('button', { name: 'アップロード' })
    fireEvent.click(uploadButton)
    fireEvent.click(uploadButton)

    expect(await screen.findByRole('dialog', { name: 'アップロード中' })).toBeVisible()
    expect(recordedRepository.createRecorded).toHaveBeenCalledWith({
      channelId: 34,
      startAt: new Date('2026-05-05T12:30').getTime(),
      endAt: new Date('2026-05-05T12:30').getTime() + 30 * 60 * 1000,
      name: 'Synthetic program',
      ruleId: 12,
      description: 'Synthetic summary',
      extended: 'Synthetic extended',
      genre1: 5,
      subGenre1: 2,
    })
    expect(recordedRepository.uploadVideoFile).not.toHaveBeenCalled()
    expect(recordedRepository.createRecorded).toHaveBeenCalledTimes(1)
  })

  // Kept separate from the "silently skips an incomplete block" proof below rather than combined
  // with it in one render: under CPU contention (coverage instrumentation plus other preflight
  // steps sharing the host) a combined test's own real-clock duration can exceed vitest's default
  // 5000ms per-test timeout, the same failure mode the comment on the split above documents for
  // this file. This test only needs the two validated blocks `fillTwoValidatedVideoBlocks` fills
  // (proving order does not need a third, incomplete block to skip -- that is entirely the next
  // test's job) and does not observe the success UI, so it stops as soon as both uploads are
  // confirmed.
  it('[AC 3.10] uploads validated video blocks in the order the blocks were filled once metadata resolves', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root', 'backup-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    const { firstFile, secondFile } = await fillTwoValidatedVideoBlocks(recordedRepository)

    fireEvent.click(uploadPage().getByRole('button', { name: 'アップロード' }))

    await waitFor(() => {
      expect(recordedRepository.uploadVideoFile).toHaveBeenCalledTimes(2)
    })
    expect(recordedRepository.uploadVideoFile).toHaveBeenNthCalledWith(1, {
      recordedId: 901,
      parentDirectoryName: 'archive-root',
      subDirectory: 'season-one',
      viewName: 'Main upload',
      fileType: 'ts',
      file: firstFile,
    })
    expect(recordedRepository.uploadVideoFile).toHaveBeenNthCalledWith(2, {
      recordedId: 901,
      parentDirectoryName: 'archive-root',
      viewName: 'Encoded upload',
      fileType: 'encoded',
      file: secondFile,
    })
  })

  // The other half of the split described above. Needs its own third, empty block (via
  // `fillIncompleteThirdBlock`) to exercise the AC 3.11 skip branch. Also re-asserts (via
  // `toHaveBeenNthCalledWith`) that the first and second blocks are still uploaded with their own
  // file when a third, incomplete block is present -- the call-count check alone does not
  // tell the two validated blocks apart from the skipped incomplete one.
  it('[AC 3.11] silently skips an incomplete video block without blocking submission', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root', 'backup-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    const { firstFile, secondFile } = await fillIncompleteThirdBlock(recordedRepository)

    fireEvent.click(uploadPage().getByRole('button', { name: 'アップロード' }))

    await waitFor(() => {
      expect(recordedRepository.uploadVideoFile).toHaveBeenCalledTimes(2)
    })
    expect(recordedRepository.uploadVideoFile).toHaveBeenNthCalledWith(1, {
      recordedId: 901,
      parentDirectoryName: 'archive-root',
      subDirectory: 'season-one',
      viewName: 'Main upload',
      fileType: 'ts',
      file: firstFile,
    })
    expect(recordedRepository.uploadVideoFile).toHaveBeenNthCalledWith(2, {
      recordedId: 901,
      parentDirectoryName: 'archive-root',
      viewName: 'Encoded upload',
      fileType: 'encoded',
      file: secondFile,
    })
  })

  // Needs only the single video block `fillMetadataFields` fills, since AC 3.4/3.13 here are about
  // what happens once the (however many) uploads finish, not about upload ordering -- that is the
  // ordering test's job, which uses the heavier two-block form for exactly that reason. It fills
  // the 'full' scope, though: AC 3.13 keeps *the current form values* after success, so every
  // optional field (genre, sub genre, rule, description, extended) must be filled before upload
  // for the post-upload assertions below to prove it, not just the required ones.
  it('[AC 3.4] [AC 3.13] reports success and updates the route with a fresh timestamp once upload completes', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root', 'backup-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    await fillMetadataFields(recordedRepository, 'full')

    fireEvent.click(uploadPage().getByRole('button', { name: 'アップロード' }))

    await waitFor(() => {
      expect(recordedRepository.uploadVideoFile).toHaveBeenCalledTimes(1)
    })
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('アップロード完了')).toBeVisible()
    // Flush the uploading dialog's remount-delay timer while still under fake timers, so
    // switching back to real timers below does not drop it and hang the waitFor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    vi.useRealTimers()

    expectHashRoute('#/recorded/upload')
    // AC 3.13: every value that was in the form when the upload started is still there.
    expectMuiSelectText(/放送局※?/, 'Synthetic half channel', uploadPage())
    expect(uploadPage().getByLabelText('開始')).toHaveValue('2026-05-05T12:30')
    expect(uploadPage().getByLabelText('長さ(分)')).toHaveValue('30')
    expect(uploadProgramNameInput()).toHaveValue('Synthetic program')
    expect(uploadPage().getByLabelText('description')).toHaveValue('Synthetic summary')
    expect(uploadPage().getByLabelText('extended')).toHaveValue('Synthetic extended')
    expectMuiSelectText(/^genre/, 'Synthetic genre', uploadPage())
    expectMuiSelectText(/^sub genre/, 'トークバラエティ', uploadPage())
    expect(uploadPage().getByRole('combobox', { name: 'ルール' })).toHaveValue('Synthetic rule')
    expect(uploadVideoBlock(0).getByLabelText('name')).toHaveValue('Main upload')
    expect(uploadVideoBlock(0).getByLabelText('sub directory')).toHaveValue('season-one')
    expectMuiSelectText(/file type/, 'ts', uploadVideoBlock(0))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'アップロード中' })).not.toBeInTheDocument()
    })
  })

  it('[AC 3.5] reports metadata failure without rollback and closes the uploading dialog', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.createRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-create-failed',
      message: 'metadata failed',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()
    vi.useFakeTimers()
    fireEvent.click(uploadPage().getByRole('button', { name: 'アップロード' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('アップロードに失敗')).toBeVisible()
    // Flush the uploading dialog's remount-delay timer while still under fake timers, so
    // switching back to real timers below does not drop it and hang the waitFor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    vi.useRealTimers()
    expect(recordedRepository.uploadVideoFile).not.toHaveBeenCalled()
    expect(recordedRepository.deleteRecorded).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'アップロード中' })).not.toBeInTheDocument()
    })
  })

  it('[AC 3.15] does not show upload snackbar after route leave and rolls back metadata created before cancellation', async () => {
    const recordedRepository = createRecordedRepository()
    const metadataResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['createRecorded']>>>()
    vi.mocked(recordedRepository.createRecorded).mockReturnValueOnce(metadataResult.promise)

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()
    fireEvent.click(uploadPage().getByRole('button', { name: 'アップロード' }))
    expect(await screen.findByRole('dialog', { name: 'アップロード中' })).toBeVisible()

    act(() => {
      window.location.hash = '#/'
    })
    await waitFor(() => {
      expect(screen.queryByTestId('recorded-upload-page')).not.toBeInTheDocument()
    })
    metadataResult.resolve({ ok: true, value: { recordedId: 901 } })

    await waitFor(() => {
      expect(recordedRepository.deleteRecorded).toHaveBeenCalledWith(901)
    })
    expect(recordedRepository.uploadVideoFile).not.toHaveBeenCalled()
    expect(screen.queryByText('アップロード完了')).not.toBeInTheDocument()
    expect(screen.queryByText('アップロードに失敗')).not.toBeInTheDocument()
  })
})
