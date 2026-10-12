import { fireEvent, render, screen, within } from '@testing-library/react'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { changeSettingsSelect, createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'

export function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

export function uploadProgramNameInput() {
  return within(screen.getByTestId('recorded-upload-page')).getAllByLabelText('name')[0]!
}

export function uploadVideoBlock(index: number) {
  return within(screen.getByTestId(`recorded-upload-video-block-${index}`))
}

// Every plain text/file input is looked up once, before any of them is changed, and the two select
// interactions run on top of those same elements (they stay mounted across the selects, so the
// events reach exactly the inputs a user would type into). The first label query after each DOM
// change costs tens of ms under coverage instrumentation, so interleaving "look up one input,
// change it" for every field is what made this helper expensive in every test that calls it.
export async function fillRequiredUploadFields(file = new File(['first'], 'main.ts')) {
  const page = within(screen.getByTestId('recorded-upload-page'))
  const startInput = page.getByLabelText('開始')
  const lengthInput = page.getByLabelText('長さ(分)')
  const nameInput = uploadProgramNameInput()
  const blockNameInput = uploadVideoBlock(0).getByLabelText('name')
  const fileInput = uploadVideoBlock(0).getByLabelText('video file')

  await changeSettingsSelect(/放送局※?/, /Synthetic .*channel/)
  fireEvent.change(startInput, { target: { value: '2026-05-05T12:30' } })
  fireEvent.change(lengthInput, { target: { value: '30' } })
  fireEvent.change(nameInput, { target: { value: 'Synthetic program' } })
  fireEvent.change(blockNameInput, {
    target: { value: 'Main upload' },
  })
  await changeSettingsSelect(/file type/, 'ts', uploadVideoBlock(0))
  fireEvent.change(fileInput, {
    target: { files: [file] },
  })
}

// The first `<App>` render in a file pays a one-time React/MUI/theme first-use cache and JIT
// warm-up cost that later renders in the same file do not pay again (see
// `warmUpSearchAppRender` in `searchRuleSupport.tsx`, which measured this directly for the search
// route: ~2.1s cold vs. ~1.5s warm). Left inside a test body, that cost competes with the same
// test's own `findBy*`/test-timeout budget, and under coverage instrumentation plus CPU contention
// from other test files running in parallel, that budget is sometimes missed even though the same
// assertion is comfortably fast once the file is warm. Calling this once from `beforeAll` pays
// that one-time cost against the hook's own (separate, larger) timeout instead of a test's budget,
// so every actual `it` in the file only ever renders `<App>` warm.
export async function warmUpRecordedUploadAppRender() {
  const previousHash = window.location.hash
  window.history.replaceState(null, '', '/#/recorded/upload')

  const warmup = render(
    <App
      settings={new DefaultSettingsFactory().create()}
      apiRepository={createShellRepository()}
      recordedApiRepository={createRecordedRepository()}
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

  await screen.findByTestId('recorded-upload-page', undefined, { timeout: 8000 })
  warmup.unmount()
  window.history.replaceState(null, '', previousHash)
}
