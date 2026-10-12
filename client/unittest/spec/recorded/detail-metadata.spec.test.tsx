import { fireEvent, render, screen, within } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createPlaybackNavigationConfig, createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded detail route, data, and actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 4.1] [AC 3.2] [AC 3.12] [AC 3.18] [AC 3.20] [AC 3.33] fetches detail with half-width setting, renders metadata, video files, and safe links', async () => {
    const recordedRepository = createRecordedRepository()
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isHalfWidthDisplayed: false,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('録画詳細')
    const page = await screen.findByTestId('recorded-detail-page')
    expect(page).toHaveTextContent('Synthetic detail target')
    expect(page).toHaveTextContent('Synthetic channel')
    expect(page).toHaveTextContent('Synthetic detail description')
    expect(page).toHaveTextContent('ニュース・報道 / 天気')
    expect(page).toHaveTextContent('drop: 2, error: 1, scrambling: 0 3.0KB')
    expect(screen.getByAltText('Synthetic detail target サムネイル')).toHaveAttribute(
      'src',
      './api/thumbnails/501',
    )
    const link = screen.getByRole('link', { name: 'https://example.invalid/detail/path' })
    expect(link).toHaveAttribute('href', 'https://example.invalid/detail/path')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(recordedRepository.fetchRecordedDetail).toHaveBeenCalledWith({
      recordedId: 301,
      isHalfWidth: false,
    })
    expect(emitDoneGetData).toHaveBeenCalledTimes(1)
  })

  it('[AC 3.2] renders the original no-image fallback in recorded detail when thumbnails are missing', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: true,
      value: {
        id: 301,
        name: 'Synthetic detail without thumbnail',
        channelId: 401,
        channelName: 'Synthetic channel',
        description: '',
        extended: '',
        isProtected: false,
        isRecording: false,
        isEncoding: false,
        videoFiles: [],
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const hero = await screen.findByTestId('recorded-detail-hero')
    expect(within(hero).getByTestId('recorded-no-image')).toHaveAttribute('src', './img/noimg.png')
    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')
    expect(css).toMatch(/\.thumbnail,\s*\.noImage\s*\{[\s\S]*?aspect-ratio: 16 \/ 9;/)
    expect(css).toMatch(/\.thumbnail,\s*\.noImage\s*\{[\s\S]*?background: transparent;/)
    expect(css).toMatch(/\.thumbnail,\s*\.noImage\s*\{[\s\S]*?border-radius: 0;/)
    expect(css).not.toContain('background: #d7dee5;')
    expect(existsSync('public/img/noimg.png')).toBe(true)
    expect(css).toMatch(
      /\.detailHero \.thumbnail,\s*\.detailHero \.noImage\s*\{[\s\S]*?max-height: 400px;[\s\S]*?width: 100%;/,
    )
    expect(css).toMatch(
      /\.recordedDetailPage \.thumbnail,\s*\.recordedDetailPage \.noImage\s*\{[\s\S]*?max-height: 240px;[\s\S]*?min-width: 100px;/,
    )
    expect(css).toMatch(
      /@media \(min-width: 800px\) \{[\s\S]*?\.recordedDetailPage \.thumbnail,\s*\.recordedDetailPage \.noImage\s*\{[\s\S]*?max-height: 400px;[\s\S]*?min-width: 400px;/,
    )
  })

  it('[AC 1.5] keeps recorded list no-image geometry aligned with legacy v-img slots', async () => {
    const recordedRepository = createRecordedRepository()
    window.history.replaceState(null, '', '/#/recorded')

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isShowDropInfoInsteadOfDescription: true,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={760}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-no-image')

    const css = readFileSync('src/features/recorded/RecordedPage.module.css', 'utf8')
    expect(css).toMatch(
      /\.cards \.card \.thumbnail,\s*\.cards \.card \.noImage\s*\{[\s\S]*?min-width: 300px;[\s\S]*?width: 300px;/,
    )
    expect(css).toMatch(
      /\.smallCards \.card \.thumbnail,\s*\.smallCards \.card \.noImage\s*\{[\s\S]*?height: 100px;[\s\S]*?max-width: 200px;/,
    )
  })

  it('[AC 3.33] uses the legacy numeric channel fallback when detail channel name is missing', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: true,
      value: {
        id: 301,
        name: 'Synthetic detail without channel name',
        channelId: 401,
        genre1: 7,
        subGenre1: 0,
        genres: [],
        description: '',
        extended: '',
        isProtected: false,
        isRecording: false,
        isEncoding: false,
        videoFiles: [],
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('recorded-detail-page')
    expect(page).toHaveTextContent('401')
    expect(page).not.toHaveTextContent('channel 401')
    expect(page).toHaveTextContent('アニメ・特撮 / 国内アニメ')
  })

  it('[AC 3.33] [AC 3.20] [AC 4.3] renders recorded detail metadata and file actions with the legacy Vue structure', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('recorded-detail-page')
    expect(page).toHaveTextContent('ニュース・報道 / 天気')
    expect(page).toHaveTextContent('drop: 2, error: 1, scrambling: 0 3.0KB')
    expect(screen.queryByRole('button', { name: 'ドロップログを表示' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'play synthetic-original' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'streaming synthetic-encoded' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'streaming' }))
    expect(await screen.findByRole('button', { name: 'synthetic-original' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'synthetic-encoded' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'ストリーム選択' })).not.toBeInTheDocument()
  })

  it('[AC 3.16] [AC 3.20] hides recorded detail drop metadata while the item is still recording', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: true,
      value: {
        id: 301,
        name: 'Synthetic recording detail',
        channelId: 401,
        channelName: 'Synthetic channel',
        startAt: 1_700_000_000_000,
        endAt: 1_700_000_600_000,
        description: 'Synthetic detail description',
        extended: '',
        isProtected: false,
        isRecording: true,
        isEncoding: false,
        dropLogFile: {
          id: 601,
          dropCnt: 0,
          errorCnt: 0,
          scramblingCnt: 0,
        },
        videoFiles: [],
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('recorded-detail-page')
    expect(page).toHaveTextContent('Synthetic recording detail')
    expect(page).not.toHaveTextContent('drop: 0, error: 0, scrambling: 0')
  })

  it("[AC 3.16] [AC 3.20] renders no drop placeholder for a finished recording without a dropLogFile, unlike v2's always-rendered empty .drop div", async () => {
    // v2 source (5cf2ea383): client/src/views/RecordedDetail.vue:41 always renders
    // `<div class="drop" ...>` even when `recorded.display.drop` is undefined (empty text, pointer cursor,
    // click no-ops because RecordedDetail.vue's showDropLog() also returns early without a dropLogFile).
    // Decision: this is treated as a v2 rendering quirk (an inert, empty, falsely-clickable element) and is
    // intentionally not carried over — v3 omits the whole control instead of rendering an empty button.
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: true,
      value: {
        id: 301,
        name: 'Synthetic detail without drop log',
        channelId: 401,
        channelName: 'Synthetic channel',
        startAt: 1_700_000_000_000,
        endAt: 1_700_000_600_000,
        description: 'Synthetic detail description',
        extended: '',
        isProtected: false,
        isRecording: false,
        isEncoding: false,
        videoFiles: [],
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('recorded-detail-page')
    expect(page).toHaveTextContent('Synthetic detail without drop log')
    expect(within(page).queryByRole('button', { name: /drop/ })).not.toBeInTheDocument()
    expect(page.querySelector('[data-has-drop-error]')).not.toBeInTheDocument()
  })
})
