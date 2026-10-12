import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'

// `/guide/setting` の「チャンネル高さ」行は 1 行で表示され、隣のプルダウンは行の右端に
// 右寄せになる。
//
// 基準: v2（`5cf2ea383`、`GuideSizeSetting.vue`）は 1272x900 で「チャンネル高さ」を
// 1行表示し、隣の select は幅 100px で行の右端に張り付く（1272x900 での実測）。
// v3 では `AppSelect` に `wrapperClassName` を渡して、`AppSelect` が内部で必ず生成する
// `<div data-app-select-wrapper>`（AppSelect.tsx）自身を `.settingField`（display:flex）の
// flex item にし、`flex: 0 0 100px; margin-left:auto; max-width/min-width:100px` をその
// wrapper に付けている（GuidePage.module.css）。`wrapperClassName` が無いと wrapper は inline
// `style={width:'100%'}` を受けて行の残り幅いっぱいに広がり、ラベルが "チャンネル\n高さ" の
// ように折り返され、値も行の右端ではなく label のすぐ右に表示される。
//
// 他の visual spec との分担: `client/visual/settings-screen-geometry.spec.ts` は
// `/settings`（アプリ全体設定）だけを対象にする。`/guide/setting`（番組表サイズ設定）の幾何は
// この spec が担当する。select の開閉・値の反映・localStorage 永続化といった機能の検査は
// ラベルが折り返すか・select が右寄せかという幾何情報を assert しないので、幾何はこの spec が検査する。

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('keeps the guide size row label on one line and right-aligns the size select', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1272, height: 900 })
  await page.goto('/#/guide/setting')
  await page.getByTestId('guide-setting-page').waitFor()

  const rows = await page.getByTestId('guide-setting-page').evaluate((root) => {
    const labels = Array.from(root.querySelectorAll('label')).filter((label) =>
      label.querySelector('[data-app-select-wrapper]'),
    )

    return labels.map((label) => {
      const span = label.querySelector('span') as HTMLSpanElement
      const wrapper = label.querySelector('[data-app-select-wrapper]') as HTMLElement
      const labelRect = label.getBoundingClientRect()
      const wrapperRect = wrapper.getBoundingClientRect()

      return {
        field: span.textContent,
        // getClientRects() returns one rect per wrapped line box; more than one means the label
        // text wrapped onto a second line.
        labelLineCount: span.getClientRects().length,
        wrapperWidth: wrapperRect.width,
        wrapperRight: wrapperRect.right,
        rowRight: labelRect.right,
      }
    })
  })

  // 通常表示・モバイル表示 各 7 field 分。
  expect(rows.length).toBe(14)
  for (const row of rows) {
    expect(row.labelLineCount, `${row.field} label should render on a single line`).toBe(1)
    expect(row.wrapperWidth, `${row.field} select should stay a fixed 100px box`).toBeCloseTo(
      100,
      0,
    )
    expect(
      row.wrapperRight,
      `${row.field} select should be flush with the row's right edge`,
    ).toBeCloseTo(row.rowRight, 0)
  }
})
