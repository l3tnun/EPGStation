import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createShellTheme, resolveShellThemeMode } from '@/app/theme'

describe('App Shell theme resolver implementation edges', () => {
  it('uses OS preference only when saved settings request OS color theme', () => {
    expect(
      resolveShellThemeMode({
        settings: {
          shouldUseOSColorTheme: true,
          isForceDarkTheme: false,
        },
        osPrefersDark: true,
      }),
    ).toBe('dark')
    expect(
      resolveShellThemeMode({
        settings: {
          shouldUseOSColorTheme: true,
          isForceDarkTheme: true,
        },
        osPrefersDark: false,
      }),
    ).toBe('light')
  })

  it('uses saved force-dark setting when OS color theme is disabled', () => {
    expect(
      resolveShellThemeMode({
        settings: {
          shouldUseOSColorTheme: false,
          isForceDarkTheme: true,
        },
        osPrefersDark: false,
      }),
    ).toBe('dark')
    expect(
      resolveShellThemeMode({
        settings: {
          shouldUseOSColorTheme: false,
          isForceDarkTheme: false,
        },
        osPrefersDark: true,
      }),
    ).toBe('light')
  })

  it('maps dark shell theme to legacy-compatible surface and switch tokens', () => {
    const theme = createShellTheme('dark')

    expect(theme.palette.background.default).toBe('#121212')
    expect(theme.palette.background.paper).toBe('#1e1e1e')
    expect(theme.palette.primary.main).toBe('#90caf9')
    expect(theme.palette.text.secondary).toBe('rgba(255,255,255,0.7)')
    expect(theme.components?.MuiSwitch?.styleOverrides).toBeDefined()
  })

  it('maps checkbox checked state to the primary legacy accent in light and dark themes', () => {
    const lightTheme = createShellTheme('light')
    const darkTheme = createShellTheme('dark')

    expect(lightTheme.components?.MuiCheckbox?.styleOverrides).toMatchObject({
      root: {
        '&.Mui-checked': {
          color: '#1976d2',
        },
      },
    })
    expect(darkTheme.components?.MuiCheckbox?.styleOverrides).toMatchObject({
      root: {
        '&.Mui-checked': {
          color: '#90caf9',
        },
      },
    })
  })

  it('does not reserve helper-text row height through a theme-wide MuiFormControl override', () => {
    // AC 32 scopes the reserved helper-text row to `/reserves/manual` add-mode option-panel
    // fields (see `ReservesPage.module.css` `.manualFormGrid`/`.manualWideField` and
    // `manualOptionPanelsDirect.spec.test.tsx`). A theme-wide `MuiFormControl` override
    // would push this same padding onto every form control app-wide, including
    // fixed-height dialog rows (Guide ProgramDialog `programOptionList`,
    // `RecordedStreamSelectDialog`), forcing unwanted scroll/growth there.
    const lightTheme = createShellTheme('light')
    const darkTheme = createShellTheme('dark')

    expect(lightTheme.components?.MuiFormControl).toBeUndefined()
    expect(darkTheme.components?.MuiFormControl).toBeUndefined()
  })

  it('publishes CSS palette variables used by routed CSS modules', () => {
    const darkTheme = createShellTheme('dark')

    expect(darkTheme.components?.MuiCssBaseline?.styleOverrides).toMatchObject({
      body: {
        '--mui-palette-background-paper': '#1e1e1e',
        '--mui-palette-text-primary': 'rgba(255,255,255,0.87)',
        '--mui-palette-text-secondary': 'rgba(255,255,255,0.7)',
      },
    })
  })
})

// 期待値は EPGStation v2 の `client/public` の中身（sha256 と manifest.json）。
// 現在の `public/` を読み、v2 から変わっていないことを確かめる。
const originalAssetSha256 = {
  'icon/android-large.png': '0e5a09eb42332f9ac15025bdf147df04428b2dbc08a35069a2d2a4e4d26b399e',
  'icon/android.png': '0c0aa24632788020c1a561662f50869c59c15102264e337b3ad770ba6cae8f02',
  'icon/favicon.png': 'b4960a1d3b3c9ba6ae568cd913ba88ad6ab86384a98660860d11e54b1093577b',
  'icon/icon-192.png': '85b8ddc2fe9fe786216860019d952b1d6e80cf69079a9f567a725a04c1f8e693',
  'icon/icon-512.png': '8aa8259a15b50137ec1cc706b3b1965ffe365f9e89d1f138cf4059e25dc93735',
  'icon/ios-large.png': '9548d04a79f10ce019905fb993731840e1f25a5870dbacec507d76d6966d1506',
  'icon/ios.png': 'd8b3c031621c213a227ed3498ee78e1eecd2e8e86fa438e68f863fab2f6ca7b5',
  'icon/original.png': '77573bf332bd5b934f3fcc020d69b8460f9107e2f774781e33a881a929b81297',
  'icon/pwa-large.png': '1ecc414484634efbfe7243bbe18230c2adf723ddfef09e810ff02249a822f719',
  'serviceWorker.js': '9a0b64909e0a681b3b4270a3956ca5c595cdc2c3a3be9e264d81469c44707bd1',
} as const

const originalManifest = {
  name: 'EPGStation',
  short_name: 'EPGStation',
  icons: [
    { src: './icon/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: './icon/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
  start_url: './',
  display: 'standalone',
  background_color: '#fff',
  theme_color: '#3f51b5',
}

describe('App Shell static document parity', () => {
  const hashPublicFile = (relativePath: string) =>
    createHash('sha256')
      .update(readFileSync(`${process.cwd()}/public/${relativePath}`))
      .digest('hex')

  it('uses the original favicon asset and document link target', () => {
    const indexHtml = readFileSync(`${process.cwd()}/index.html`, 'utf8')

    expect(indexHtml).toContain('<link rel="icon" href="./icon/favicon.png" />')
    expect(hashPublicFile('icon/favicon.png')).toBe(originalAssetSha256['icon/favicon.png'])
  })

  it('publishes the original PWA manifest and install icon metadata', () => {
    const indexHtml = readFileSync(`${process.cwd()}/index.html`, 'utf8')
    const reactManifest = JSON.parse(
      readFileSync(`${process.cwd()}/public/manifest.json`, 'utf8'),
    ) as unknown

    expect(indexHtml).toContain(
      '<link rel="manifest" href="./manifest.json" crossorigin="use-credentials" />',
    )
    expect(indexHtml).toContain('<meta name="mobile-web-app-capable" content="yes" />')
    expect(indexHtml).toContain('<meta name="theme-color" content="#3f51b5" />')
    expect(indexHtml).toContain(
      '<link rel="apple-touch-icon-precomposed" href="./icon/ios.png" sizes="180x180" />',
    )
    expect(indexHtml).toContain('<link rel="icon" href="./icon/android.png" />')
    expect(reactManifest).toStrictEqual(originalManifest)
  })

  it('publishes the original service worker script byte-identically', () => {
    expect(hashPublicFile('serviceWorker.js')).toBe(originalAssetSha256['serviceWorker.js'])
  })

  it('keeps every original PWA icon asset byte-identical', () => {
    const pwaIcons = [
      'android-large.png',
      'android.png',
      'icon-192.png',
      'icon-512.png',
      'ios-large.png',
      'ios.png',
      'original.png',
      'pwa-large.png',
    ] as const

    for (const iconName of pwaIcons) {
      expect(hashPublicFile(`icon/${iconName}`)).toBe(originalAssetSha256[`icon/${iconName}`])
    }
  })
})
