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

describe('App Shell static document parity', () => {
  const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

  it('uses the original favicon asset and document link target', () => {
    const indexHtml = readFileSync(`${process.cwd()}/index.html`, 'utf8')

    expect(indexHtml).toContain('<link rel="icon" href="./icon/favicon.png" />')
    expect(hashFile(`${process.cwd()}/public/icon/favicon.png`)).toBe(
      hashFile(`${process.cwd()}/../client/public/icon/favicon.png`),
    )
  })

  it('publishes the original PWA manifest and install icon metadata', () => {
    const indexHtml = readFileSync(`${process.cwd()}/index.html`, 'utf8')
    const reactManifest = JSON.parse(
      readFileSync(`${process.cwd()}/public/manifest.json`, 'utf8'),
    ) as unknown
    const originalManifest = JSON.parse(
      readFileSync(`${process.cwd()}/../client/public/manifest.json`, 'utf8'),
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
    expect(hashFile(`${process.cwd()}/public/serviceWorker.js`)).toBe(
      hashFile(`${process.cwd()}/../client/public/serviceWorker.js`),
    )
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
    ]

    for (const iconName of pwaIcons) {
      expect(hashFile(`${process.cwd()}/public/icon/${iconName}`)).toBe(
        hashFile(`${process.cwd()}/../client/public/icon/${iconName}`),
      )
    }
  })
})
