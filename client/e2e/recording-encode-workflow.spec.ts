import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  SYNTHETIC_ENCODE_RUNNING_ID,
  SYNTHETIC_ENCODE_WAITING_ID,
  SYNTHETIC_RECORDING_VIDEO_ID_A,
  SYNTHETIC_RECORDING_VIDEO_ID_B,
  createRecordingEncodeRequestLog,
  installRecordingEncodeApiMocks,
  recordingEncodeFixtureSecrecyText,
} from './support/recordingEncodeMocks'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

async function setRecordingEncodeSettings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        recordingLength: 12,
        isHalfWidthDisplayed: false,
      }),
    )
  })
}

test('uses only synthetic Recording and Encode fixture values', () => {
  const forbiddenFixturePatterns = [
    /kodi:\/\/|https?:\/\//i,
    /user(name)?|password|token|secret|authorization/i,
    /\/Users\/|\/home\/[^/]+\/|[A-Z]:\\/,
    /ffmpeg|ffprobe|encoder(command|path)|command/i,
  ]

  for (const pattern of forbiddenFixturePatterns) {
    expect(recordingEncodeFixtureSecrecyText).not.toMatch(pattern)
  }
})

test('drives Recording list query, menu visibility, bulk delete, empty, and failure states', async ({
  page,
}, testInfo) => {
  await setRecordingEncodeSettings(page)
  const requestLog = createRecordingEncodeRequestLog()
  await installRecordingEncodeApiMocks(page, { requestLog })

  await page.goto('/#/recording?page=2')

  await expect(page.getByTestId('title-bar').getByRole('heading', { name: '録画中' })).toBeVisible()
  await expect(page.getByTestId('recording-page')).toHaveAttribute('data-recording-total', '2')
  await expect(page.getByTestId('recording-list-item').first()).toContainText(
    'Synthetic Recording Alpha',
  )
  await expect(page.getByText('Synthetic Recording Channel')).toBeVisible()
  await expect(page.getByText('7101')).toHaveCount(0)
  expect(requestLog.apiPaths).toContain('/api/recording?isHalfWidth=false&limit=12&offset=12')

  await page.getByRole('button', { name: '録画メニュー: Synthetic Recording Alpha' }).click()
  await expect(page.getByRole('menuitem', { name: 'search' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'encode' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'stop' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '録画中を編集' }).click()
  await expect(page.getByTestId('recording-page')).toHaveAttribute('data-edit-mode', 'true')
  const firstRow = page.getByTestId('recording-list-item').first()
  await expect(firstRow).toHaveCSS(
    'height',
    testInfo.project.name.startsWith('Desktop') ? '48px' : '100px',
  )
  await expect(firstRow.getByRole('button', { name: /録画メニュー:/ })).toHaveCount(0)
  await expect(page.getByText('Synthetic Recording Alpha を選択')).toHaveCount(0)
  await firstRow.click()
  await page.getByRole('button', { name: 'すべて選択' }).click()
  await page.getByRole('button', { name: '選択項目を削除' }).click()
  const deleteDialog = page.getByRole('dialog', { name: '録画一括削除' })
  await expect(deleteDialog).toBeVisible()
  await expect(deleteDialog).toContainText('選択した 2 件の番組を削除しますか。')
  await expect(deleteDialog.getByLabel('削除対象')).toHaveCount(0)
  await expect(deleteDialog.getByRole('button', { name: 'キャンセル' })).toBeVisible()
  await expect(deleteDialog.getByRole('button', { name: '削除' })).toBeVisible()
  await page.getByRole('button', { name: '削除' }).click()
  await expect
    .poll(() => requestLog.apiPaths.filter((path) => path.startsWith('/api/videos/')))
    .toEqual([
      `/api/videos/${SYNTHETIC_RECORDING_VIDEO_ID_A}`,
      `/api/videos/${SYNTHETIC_RECORDING_VIDEO_ID_B}`,
      '/api/videos/9203',
    ])
  await expectAnnounced(page, '選択した番組を削除しました。')

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installRecordingEncodeApiMocks(page, { mode: 'recording-empty' })
  await page.goto('/#/recording?timestamp=empty')
  await expect(page.getByTestId('recording-page')).toHaveCount(0)
  await expect(page.getByTestId('recording-list-item')).toHaveCount(0)

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installRecordingEncodeApiMocks(page, { mode: 'recording-failure' })
  await page.goto('/#/recording?timestamp=failure')
  await expect(page.getByTestId('recording-page')).toHaveCount(0)
  await expectAnnounced(page, '録画データ取得に失敗')
})

test('drives Encode query, progress visibility, and single cancel workflow', async ({ page }) => {
  await setRecordingEncodeSettings(page)
  const requestLog = createRecordingEncodeRequestLog()
  await installRecordingEncodeApiMocks(page, { requestLog })

  await page.goto('/#/encode')

  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: 'エンコード' }),
  ).toBeVisible()
  await expect(page.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')
  await expect(page.getByTestId('encode-page')).toHaveAttribute('data-waiting-count', '1')
  expect(requestLog.apiPaths).toContain('/api/encode?isHalfWidth=false')
  await expect(page.getByRole('heading', { name: 'エンコード中' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '待機中' })).toBeVisible()
  await expect(page.getByText('Synthetic Encode Running')).toBeVisible()
  await expect(page.getByText('64% synthetic-progress-log')).toBeVisible()
  await expect(page.getByText('Synthetic Encode Percent Only')).toBeVisible()
  await expect(page.getByText('50%')).toHaveCount(0)

  await page.getByRole('button', { name: 'エンコード停止: Synthetic Encode Waiting' }).click()
  await expect(page.getByTestId('single-encode-cancel-dialog')).toBeVisible()
  const singleCancelDialog = page.getByRole('dialog', { name: 'エンコード停止' })
  await expect(singleCancelDialog).toBeVisible()
  await expect(singleCancelDialog).toHaveCSS('width', '300px')
  await expect(singleCancelDialog).toHaveCSS('max-width', '300px')
  await expect(singleCancelDialog.locator('.MuiDialogContent-root')).toHaveCSS(
    'padding-top',
    '16px',
  )
  await expect(singleCancelDialog.locator('.MuiDialogContent-root')).toHaveCSS(
    'padding-bottom',
    '0px',
  )
  await expect(singleCancelDialog.locator('.MuiDialogContent-root')).toHaveCSS(
    'color',
    'rgba(0, 0, 0, 0.87)',
  )
  await expect(singleCancelDialog.locator('.MuiDialogActions-root')).toHaveCSS('min-height', '52px')
  await expect(singleCancelDialog.locator('.MuiDialogActions-root')).toHaveCSS('padding-top', '8px')
  await expect(singleCancelDialog.locator('.MuiDialogActions-root')).toHaveCSS(
    'padding-bottom',
    '8px',
  )
  await page.getByRole('button', { name: '停止' }).click()
  await expect
    .poll(() => requestLog.apiPaths)
    .toContain(`/api/encode/${SYNTHETIC_ENCODE_WAITING_ID}`)
  await expectAnnounced(page, '[synthetic-wait] Synthetic Encode Waiting を停止しました')
  expect(requestLog.methods).not.toContain('POST /api/encode')
})

test('keeps Encode main content blank when there are no running or waiting jobs', async ({
  page,
}) => {
  await setRecordingEncodeSettings(page)
  await installRecordingEncodeApiMocks(page, { mode: 'encode-empty' })

  await page.goto('/#/encode')

  const encodePage = page.getByTestId('encode-page')
  await expect(encodePage).toHaveAttribute('data-running-count', '0')
  await expect(encodePage).toHaveAttribute('data-waiting-count', '0')
  await expect(page.getByRole('heading', { name: 'エンコード中' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '待機中' })).toHaveCount(0)
  await expect(encodePage).toHaveText('')
  await expect(encodePage).toHaveJSProperty('childElementCount', 0)
})

test('drives Encode zero-selection and failure-continuing bulk cancel workflow', async ({
  page,
}) => {
  await setRecordingEncodeSettings(page)
  const requestLog = createRecordingEncodeRequestLog()
  await installRecordingEncodeApiMocks(page, {
    requestLog,
    failEncodeDeleteIds: [SYNTHETIC_ENCODE_RUNNING_ID],
  })

  await page.goto('/#/encode')
  await expect(page.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')

  await page.getByRole('button', { name: 'エンコードを編集' }).click()
  await page.getByRole('button', { name: '選択項目を削除' }).click()
  await expect(page.getByText('番組を選択してください。')).toBeVisible()

  await page.getByText('Synthetic Encode Running').click()
  await page.getByRole('button', { name: 'すべて選択' }).click()
  await page.getByRole('button', { name: '選択項目を削除' }).click()
  const bulkCancelDialog = page.getByRole('dialog', { name: 'エンコード一括停止' })
  await expect(bulkCancelDialog).toBeVisible()
  await expect(bulkCancelDialog).toHaveCSS('width', '300px')
  await expect(bulkCancelDialog).toHaveCSS('height', '120px')
  await expect(bulkCancelDialog).toContainText('選択した 3 件の番組を削除しますか。')
  await page.getByRole('button', { name: '削除' }).click()
  await expect
    .poll(() => requestLog.apiPaths.filter((path) => path.startsWith('/api/encode/')))
    .toEqual([
      `/api/encode/${SYNTHETIC_ENCODE_RUNNING_ID}`,
      '/api/encode/9302',
      `/api/encode/${SYNTHETIC_ENCODE_WAITING_ID}`,
    ])
  await expectAnnounced(page, '一部エンコードのキャンセルに失敗しました。')
  expect(requestLog.methods).not.toContain('POST /api/encode')
})
