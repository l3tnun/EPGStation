import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  installReservesApiMocks,
  manualProgramDetail,
  manualReserveEdit,
} from './support/reservesMocks'
import { selectMuiOption } from './support/muiSelect'
import { clickWithoutPointerStabilityWait } from './support/pointerInteractions'
import { expectAnnounced } from './support/notificationObservation'

// 保存 snackbar は POST / PUT の応答後に現れる。負荷が高い runner では既定の 5 秒では
// 足りずに落ちるため、test 全体の 90 秒に対して余裕のある待ち時間を明示する。
const SNACKBAR_TIMEOUT_MS = 20_000

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('adds and edits Manual Reserve with deterministic API payloads', async ({ page }) => {
  test.setTimeout(90_000)

  const reservesMocks = await installReservesApiMocks(page)

  await page.goto(`/#/reserves/manual?programId=${manualProgramDetail.id}`)

  await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute('data-manual-mode', 'add')
  await expect(page.getByRole('heading', { name: manualProgramDetail.name })).toBeVisible()
  await expect(page.getByRole('region', { name: '時刻指定予約' })).toHaveCount(0)
  await page.getByRole('switch', { name: '時刻指定' }).click()
  await expect(page.getByRole('heading', { name: manualProgramDetail.name })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '時刻指定予約' })).toBeVisible()
  const startInput = page.getByRole('textbox', { name: '開始' })
  const endInput = page.getByRole('textbox', { name: '終了' })
  await expect(startInput).toHaveValue('2026-05-06 12:00')
  await expect(endInput).toHaveValue('2026-05-06 12:45')
  // Type the replacement value keystroke by keystroke (select-all then type over the existing
  // value) instead of `fill()`, which sets the whole value in one shot and would not catch a
  // regression where the field only accepts a single, atomic, fully-formed string.
  await startInput.click()
  await startInput.selectText()
  await page.keyboard.type('2026-05-07 10:00', { delay: 30 })
  await expect(startInput).toHaveValue('2026-05-07 10:00')
  await page.getByRole('button', { name: '開始をクリア' }).click()
  await expect(startInput).toHaveValue('')
  await endInput.fill('2026-05-07 11:00')
  await page.getByRole('button', { name: '終了をクリア' }).click()
  await expect(endInput).toHaveValue('')
  const nameInput = page.getByRole('textbox', { name: 'name' })
  await nameInput.fill('Synthetic Manual Name')
  await page.getByRole('button', { name: 'nameをクリア' }).click()
  await expect(nameInput).toHaveValue('')
  await page.getByRole('switch', { name: '時刻指定' }).click()
  await expect(page.getByRole('heading', { name: manualProgramDetail.name })).toBeVisible()
  await expect(page.getByRole('region', { name: '時刻指定予約' })).toHaveCount(0)
  await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
    'data-option-panels-open',
    '0,1,2,3,6',
  )
  const panelStates = [
    { name: 'オプション', initiallyOpen: true, closed: '1,2,3,6', open: '0,1,2,3,6' },
    { name: 'ディレクトリ', initiallyOpen: true, closed: '0,2,3,6', open: '0,1,2,3,6' },
    { name: 'ファイル名形式', initiallyOpen: true, closed: '0,1,3,6', open: '0,1,2,3,6' },
    { name: 'エンコード1', initiallyOpen: true, closed: '0,1,2,6', open: '0,1,2,3,6' },
    { name: 'エンコード3', initiallyOpen: false, closed: '0,1,2,3,6', open: '0,1,2,3,5,6' },
    { name: 'ファイル削除', initiallyOpen: true, closed: '0,1,2,3', open: '0,1,2,3,6' },
  ]
  for (const panel of panelStates) {
    const header = page.getByRole('button', { name: panel.name })
    const panelRoot = page.locator(
      `[data-option-panel-index="${panel.name === 'オプション' ? 0 : panel.name === 'ディレクトリ' ? 1 : panel.name === 'ファイル名形式' ? 2 : panel.name === 'エンコード1' ? 3 : panel.name === 'エンコード3' ? 5 : 6}"]`,
    )
    await expect(header).toHaveAttribute('aria-expanded', panel.initiallyOpen ? 'true' : 'false')
    if (panel.initiallyOpen) {
      await expect
        .soft(
          panelRoot
            .locator('.MuiCollapse-root')
            .first()
            .evaluate((node) => getComputedStyle(node).transitionDuration),
          `${panel.name} option panel keeps a non-zero collapse transition`,
        )
        .resolves.not.toBe('0s')
      await header.click()
      await expect(header).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
        'data-option-panels-open',
        panel.closed,
      )
      await header.click()
      await expect(header).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
        'data-option-panels-open',
        panel.open,
      )
      await expect
        .soft(
          panelRoot
            .locator('.MuiCollapse-root')
            .first()
            .evaluate((node) => getComputedStyle(node).transitionDuration),
          `${panel.name} option panel keeps a non-zero collapse transition`,
        )
        .resolves.not.toBe('0s')
    } else {
      await header.click()
      await expect(header).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
        'data-option-panels-open',
        panel.open,
      )
      await expect
        .soft(
          panelRoot
            .locator('.MuiCollapse-root')
            .first()
            .evaluate((node) => getComputedStyle(node).transitionDuration),
          `${panel.name} option panel keeps a non-zero collapse transition`,
        )
        .resolves.not.toBe('0s')
      await header.click()
      await expect(header).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
        'data-option-panels-open',
        panel.closed,
      )
    }
  }
  await expect(page.getByLabel('mode2')).toHaveCount(0)
  await page.getByRole('button', { name: 'エンコード2' }).click()
  await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute(
    'data-option-panels-open',
    '0,1,2,3,4,6',
  )
  const mode2Select = page.getByRole('combobox', { name: /mode2/ })
  await selectMuiOption({ page, name: /mode2/, value: 'synthetic-encode-sub' })
  await expect(mode2Select).toHaveText('synthetic-encode-sub')
  await clickWithoutPointerStabilityWait(page.getByRole('button', { name: 'エンコード2' }))
  await expect(page.getByLabel('mode2')).toHaveCount(0)

  await clickWithoutPointerStabilityWait(page.getByRole('button', { name: '保存' }))
  await expectAnnounced(page, '予約を追加しました。', { timeout: SNACKBAR_TIMEOUT_MS })

  await expect
    .poll(
      () =>
        reservesMocks.calls.find(
          (call) => call.method === 'POST' && call.pathname === '/api/reserves',
        )?.body,
    )
    .toEqual({
      allowEndLack: true,
      encodeOption: {
        isDeleteOriginalAfterEncode: false,
        mode2: 'synthetic-encode-sub',
      },
      programId: manualProgramDetail.id,
    })

  await page.goto(`/#/reserves/manual?reserveId=${manualReserveEdit.id}`)
  await expect(page.getByTestId('manual-reserve-page')).toHaveAttribute('data-manual-mode', 'edit')
  await expect(page.getByRole('switch', { name: '時刻指定' })).toBeDisabled()
  await clickWithoutPointerStabilityWait(page.getByRole('button', { name: '保存' }))

  await expectAnnounced(page, '予約を更新しました。', { timeout: SNACKBAR_TIMEOUT_MS })
  await expect
    .poll(
      () =>
        reservesMocks.calls.find(
          (call) =>
            call.method === 'PUT' && call.pathname === `/api/reserves/${manualReserveEdit.id}`,
        )?.body,
    )
    .toEqual({
      allowEndLack: false,
      saveOption: {
        parentDirectoryName: 'synthetic-parent',
        directory: 'synthetic-directory',
        recordedFormat: 'synthetic-format',
      },
      encodeOption: {
        mode1: 'synthetic-encode',
        directory1: 'synthetic-encode-directory',
        isDeleteOriginalAfterEncode: true,
      },
    })
})
