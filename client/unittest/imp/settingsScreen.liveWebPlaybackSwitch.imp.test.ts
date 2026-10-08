import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SETTINGS_CONTROL_MATRIX,
  resolveVisibleSettingsControls,
} from '@/features/settings/settingsControlMatrix'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

// v2 (`client/src/views/Settings.vue:59-65`) renders a `web での再生を優先する` switch bound to
// `isPreferredPlayingLiveM2TSOnWeb` in the 放映中 section, right after `isOnAirTabListView`, gated
// by `v-if="isSupportedMpegts"`. It is a separate flag from the 録画 section's
// `isPreferredPlayingOnWeb` (`Settings.vue:204-207`), which is consumed by
// `client/src/views/RecordedDetail.vue:172`.
//
// No source file in either implementation reads `isPreferredPlayingLiveM2TSOnWeb` back to change
// behaviour -- v2's only references are its type declaration (`ISettingStorageModel.ts:11`) and its
// default (`SettingStorageModel.ts:20`). The control is still surfaced because v2 surfaces it; the
// value it persists having no consumer is recorded in the spec rather than used as a reason to drop
// the control. The scan below enforces that invariant mechanically: it fails if any source file
// outside the known storage/settings-UI list reads `isPreferredPlayingLiveM2TSOnWeb`.
describe('Settings screen 放映中 web playback switch', () => {
  const defaultTmp = new DefaultSettingsFactory().create()

  it('sits in the 放映中 section directly after the broadcast-wave tab switch', () => {
    const liveSection = SETTINGS_CONTROL_MATRIX.filter((control) => control.section === '放映中')
    const keys = liveSection.map((control) => control.key)
    const tabIndex = keys.indexOf('isOnAirTabListView')

    expect(tabIndex).toBeGreaterThanOrEqual(0)
    expect(keys[tabIndex + 1]).toBe('isPreferredPlayingLiveM2TSOnWeb')
    expect(
      SETTINGS_CONTROL_MATRIX.find((control) => control.key === 'isPreferredPlayingLiveM2TSOnWeb'),
    ).toMatchObject({
      controlType: 'switch',
      label: 'web での再生を優先する',
      section: '放映中',
      tmpTarget: 'isPreferredPlayingLiveM2TSOnWeb',
      visibleWhen: 'mpegtsSupported',
    })
  })

  it('appears only while mpegts live playback is supported', () => {
    const withMpegts = resolveVisibleSettingsControls({
      tmp: defaultTmp,
      mpegtsSupported: true,
      currentPreviewTheme: 'dark',
    }).map((control) => control.key)
    const withoutMpegts = resolveVisibleSettingsControls({
      tmp: defaultTmp,
      mpegtsSupported: false,
      currentPreviewTheme: 'dark',
    }).map((control) => control.key)

    expect(withMpegts).toContain('isPreferredPlayingLiveM2TSOnWeb')
    expect(withoutMpegts).not.toContain('isPreferredPlayingLiveM2TSOnWeb')
  })

  it('shares its label with the 録画 section switch that is actually consumed', () => {
    const sameLabel = SETTINGS_CONTROL_MATRIX.filter(
      (control) => control.label === 'web での再生を優先する',
    )

    expect(sameLabel.map((control) => [control.section, control.key])).toStrictEqual([
      ['放映中', 'isPreferredPlayingLiveM2TSOnWeb'],
      ['録画', 'isPreferredPlayingOnWeb'],
    ])
  })

  it('has no consumer that reads its value to change playback behaviour', () => {
    // Only the settings type declaration, the default-value factory, and the settings-screen
    // control matrix (which surfaces the switch itself, not a playback consumer) may reference
    // this key. Any other source file referencing it would be a live-playback consumer, which the
    // spec explicitly says does not exist.
    const allowedFiles = new Set([
      'src/shared/settings/settingsTypes.ts',
      'src/shared/settings/defaultSettings.ts',
      'src/features/settings/settingsControlRowsFront.ts',
    ])
    const srcRoot = join(process.cwd(), 'src')
    const matches: string[] = []

    for (const entry of readdirSync(srcRoot, { recursive: true })) {
      const relativePath = entry.toString()
      if (!/\.(ts|tsx)$/.test(relativePath)) {
        continue
      }

      const absolutePath = join(srcRoot, relativePath)
      const content = readFileSync(absolutePath, 'utf8')
      if (content.includes('isPreferredPlayingLiveM2TSOnWeb')) {
        matches.push(`src/${relativePath.split('\\').join('/')}`)
      }
    }

    expect(matches.sort()).toStrictEqual([...allowedFiles].sort())
    expect(matches).not.toContain('src/features/onair/LiveStreamSelectDialog.tsx')
  })
})
