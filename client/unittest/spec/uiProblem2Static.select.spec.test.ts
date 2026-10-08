import { listCssFiles, listTsxFiles } from './support/staticSourceListing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('UI2 static regression guards', () => {
  it('[AC 8.17] does not render native select controls in routed React UI', () => {
    const files = listTsxFiles(join(process.cwd(), 'src'))
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const matches = [...source.matchAll(/<select\b/g)]

      return matches.map(
        (match) => `${file}:${match.index ?? 0}: use MUI AppSelect/TextField select`,
      )
    })

    expect(failures).toEqual([])
  })

  it('[AC 8.18] keeps MUI select menus capped to the original 4.5 item height', () => {
    const files = listTsxFiles(join(process.cwd(), 'src'))
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const selectUsages = [...source.matchAll(/<(?:TextField|Select)\b/g)]

      return selectUsages
        .filter((match) => {
          const tagStart = match.index ?? 0
          const tagEnd = source.indexOf('>', tagStart)
          const openingTag = source.slice(tagStart, tagEnd === -1 ? tagStart + 500 : tagEnd + 1)

          if (file.endsWith('src/shared/AppSelect.tsx')) {
            return false
          }

          if (!/(?:\bselect\b|<AppSelect\b|<Select\b)/.test(openingTag)) {
            return false
          }

          const context = source.slice(tagStart, tagStart + 700)
          return !/appSelectMenuProps|slotProps=\{\{\s*select: \{\s*MenuProps: appSelectMenuProps/s.test(
            context,
          )
        })
        .map((match) => `${file}:${match.index ?? 0}: select menu must use appSelectMenuProps`)
    })

    expect(failures).toEqual([])
  })

  it('[AC 8.19] keeps shared AppSelect controls at the owner width', () => {
    const source = readFileSync(join(process.cwd(), 'src/shared/AppSelect.tsx'), 'utf8')

    expect(source).toContain('wrapperClassName?: string')
    expect(source).toContain("width: wrapperClassName === undefined ? '100%' : undefined")
    expect(source).toMatch(/<TextField[\s\S]*\bfullWidth\b[\s\S]*\bselect\b/)
    expect(source).toContain('className={className}')
    expect(source).not.toMatch(/minWidth:\s*\d+/)
  })

  it('[AC 8.20] keeps shared AppSelect owner classes on the MUI field instead of the clear-button wrapper', () => {
    const source = readFileSync(join(process.cwd(), 'src/shared/AppSelect.tsx'), 'utf8')
    const wrapperOpeningTag = source.match(/<div[^>]*style=\{\{ display: 'block'[^>]*>/)?.[0] ?? ''

    expect(wrapperOpeningTag).not.toContain('className={className}')
    expect(source).toMatch(/<TextField[\s\S]{0,220}className=\{className\}/)
  })

  it('[AC 8.21] keeps shared AppSelect values vertically centered and clearable without replacing the MUI theme', () => {
    const source = readFileSync(join(process.cwd(), 'src/shared/AppSelect.tsx'), 'utf8')

    expect(source).toContain("alignItems: 'center'")
    expect(source).toContain('controlHeight')
    expect(source).toContain('clearable?: boolean')
    expect(source).toContain('onClear?: () => void')
    expect(source).toContain('disableMenuInternalScroll?: boolean')
    expect(source).toContain('menuMaxVisibleItems?: number')
    expect(source).toContain('menuMaxVisibleItems === undefined && !disableMenuInternalScroll')
    expect(source).toContain('disableInternalScroll: disableMenuInternalScroll')
    expect(source).toContain('MenuProps: menuProps')
  })

  it('[AC 8.22] keeps shared ClearableTextField clear adornments vertically centered', () => {
    const source = readFileSync(join(process.cwd(), 'src/shared/ClearableTextField.tsx'), 'utf8')

    expect(source).toContain('<InputAdornment position="end"')
    expect(source).toContain("alignSelf: 'center'")
    expect(source).toContain("height: '100%'")
    expect(source).toContain('m: 0')
    expect(source).toContain('sx={{ mr: 0 }}')
    expect(source).not.toContain("mr: '-8px'")
  })

  it('[AC 8.23] does not keep routed native select overlay CSS after MUI conversion', () => {
    const files = listCssFiles(join(process.cwd(), 'src/features'))
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const matches = [...source.matchAll(/(^|[,{\n]\s*)[.#][^{,\n]+(?:\s|>)select(?:[^\w-]|$)/gm)]

      return matches
        .filter((match) => !/user-select/.test(match[0]))
        .map(
          (match) => `${file}:${match.index ?? 0}: native select CSS must not style MUI controls`,
        )
    })

    expect(failures).toEqual([])
  })

  it('[AC 8.24] does not render blank visible select options', () => {
    const files = listTsxFiles(join(process.cwd(), 'src'))
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const matches = [
        ...source.matchAll(/<option\s+value=(?:""|{''})\s*><\/option>/g),
        ...source.matchAll(/<MenuItem\s+value=(?:""|{''})\s*>\s*<em\s*\/>\s*<\/MenuItem>/g),
      ]

      return matches.map((match) => `${file}:${match.index ?? 0}`)
    })

    expect(failures).toEqual([])
  })

  it('[AC 8.25] does not expose field-name placeholders as visible MUI select options', () => {
    const files = listTsxFiles(join(process.cwd(), 'src'))
    const fieldNames = [
      'channel',
      'channelId',
      'directory',
      'file type',
      'genre',
      'range',
      'start',
      'sub genre',
      'ジャンル',
      'ルール',
      '放送局',
    ]
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')

      return fieldNames.flatMap((fieldName) => {
        const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const optionPattern = new RegExp(
          String.raw`\{\s*label:\s*['"]${escaped}['"],\s*value:\s*['"]['"]\s*\}(?!\s*,?\s*hidden:\s*true)`,
          'g',
        )
        const menuItemPattern = new RegExp(
          String.raw`<MenuItem\s+value=(?:""|{''})(?![^>]*sx=\{\{\s*display:\s*['"]none['"]\s*\}\})[^>]*>\s*${escaped}\s*</MenuItem>`,
          'g',
        )
        const visibleEmptyMenuItemPattern =
          /<MenuItem\s+value=(?:""|{''})(?![^>]*sx=\{\{\s*display:\s*['"]none['"]\s*\}\})/g
        const matches = [
          ...source.matchAll(optionPattern),
          ...source.matchAll(menuItemPattern),
          ...source.matchAll(visibleEmptyMenuItemPattern),
        ]

        return matches.map(
          (match) => `${file}:${match.index ?? 0}: hide field-name placeholder "${fieldName}"`,
        )
      })
    })

    expect(failures).toEqual([])
  })

  it('[AC 8.26] does not keep manual dropdown arrow decorations on MUI select owners', () => {
    const files = listCssFiles(join(process.cwd(), 'src'))
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const matches = [
        ...source.matchAll(
          /(?:selectDisplay|recordedSearchSelectField)[^{]*::(?:after|before)\s*\{/g,
        ),
        ...source.matchAll(/>\s*span::before\s*\{\s*content:\s*['"]\\25BE['"]/g),
        ...source.matchAll(
          /[^{}]*(?:select|Select|MuiSelect)[^{}]*\{[^{}]*background-image\s*:[^{}]*\}/gi,
        ),
        ...source.matchAll(
          /[^{]*::(?:after|before)\s*\{(?=[^}]*border-left:\s*\d+px\s+solid\s+transparent)(?=[^}]*border-right:\s*\d+px\s+solid\s+transparent)(?=[^}]*border-top:\s*\d+px\s+solid)[^}]*\}/g,
        ),
      ]

      return matches.map((match) => `${file}:${match.index ?? 0}: remove manual select arrow`)
    })

    expect(failures).toEqual([])
  })
})
