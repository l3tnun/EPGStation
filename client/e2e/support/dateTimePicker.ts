import { expect, type Locator } from '@playwright/test'

// 日時 picker dialog の calendar の曜日 header（左の列から順）が月曜始まりの日本語であること。
export async function expectMondayFirstCalendar(dialog: Locator): Promise<void> {
  await expect(dialog.getByRole('columnheader')).toHaveText([
    '月',
    '火',
    '水',
    '木',
    '金',
    '土',
    '日',
  ])
}

// calendar を指定の月（例: 2026, 5）へ「先月」「来月」で動かす。
export async function showCalendarMonth(
  dialog: Locator,
  year: number,
  month: number,
): Promise<void> {
  const label = dialog.getByText(`${year}年${month}月`, { exact: true })
  for (let step = 0; step < 240; step += 1) {
    if ((await label.count()) > 0) {
      return
    }
    // 月の切り替えの animation の間は前の月と次の月の見出しが両方 DOM にあるので、1 つになるまで待つ。
    const header = dialog.locator('[id$="-grid-label"]')
    await expect(header).toHaveCount(1)
    const text = (await header.textContent()) ?? ''
    const match = /^(\d+)年(\d+)月$/.exec(text)
    if (match === null) {
      throw new Error(`calendar の月の表示を読めません: ${text}`)
    }
    const shown = Number(match[1]) * 12 + Number(match[2])
    const goal = year * 12 + month
    await dialog.getByRole('button', { name: shown > goal ? '先月' : '来月' }).click()
    await expect(header.filter({ hasNotText: text })).toHaveCount(1)
  }
  throw new Error(`calendar を ${year}年${month}月へ動かせません`)
}

// calendar で日を選び、時と分を clock で選ぶ。分は 5 の倍数を指定する。
export async function pickDateTime(
  dialog: Locator,
  {
    year,
    month,
    day,
    hour,
    minute,
  }: { year: number; month: number; day: number; hour: number; minute: number },
): Promise<void> {
  await dialog.getByRole('tab', { name: '日付を選択' }).click()
  await showCalendarMonth(dialog, year, month)
  // 月の切り替えの間は前の月の週の行も DOM に残るので、1 つになるまで待つ。
  await expect(dialog.getByRole('rowgroup')).toHaveCount(1)
  await dialog
    .getByRole('grid')
    .getByRole('gridcell', { name: String(day), exact: true })
    .click()
  await dialog.getByRole('tab', { name: '時間を選択' }).click()
  await dialog.getByRole('option', { name: `${hour} 時間`, exact: true }).click()
  await dialog.getByRole('option', { name: `${minute} 分`, exact: true }).click()
}
