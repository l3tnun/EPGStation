import { listCssFiles, listTsxFiles } from './support/staticSourceListing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('UI2 static regression guards', () => {
  it('[AC 8.27] [AC 7.12] does not render native checkboxes outside switch controls', () => {
    const files = listTsxFiles(join(process.cwd(), 'src'))
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const matches = [...source.matchAll(/<input\b[^>]*type=(?:"checkbox"|'checkbox')[^>]*>/gs)]

      return matches
        .filter((match) => !/\brole=(?:"switch"|'switch')/.test(match[0]))
        .map((match) => `${file}:${match.index ?? 0}`)
    })

    expect(failures).toEqual([])
  })

  it('[AC 8.28] keeps routed checkbox owners on MUI Checkbox and preserves primary checked color', () => {
    const files = listTsxFiles(join(process.cwd(), 'src'))
    const checkboxOwners = files
      .filter((file) => readFileSync(file, 'utf8').includes("from '@mui/material/Checkbox'"))
      .map((file) => file.replace(`${process.cwd()}/`, ''))
      .sort()

    expect(checkboxOwners).toEqual([
      'src/features/guide/ProgramDialog.tsx',
      'src/features/recorded/components/AddEncodeDialog.tsx',
      'src/features/recorded/components/RecordedDeleteDialogs.tsx',
      'src/features/recorded/components/RecordedSearchDialog.tsx',
      'src/features/reserves/ManualReservePage.tsx',
      'src/features/search/rule/components/ChannelMultiSelect.tsx',
      'src/features/search/rule/components/SearchCheckbox.tsx',
    ])

    const cssFiles = listCssFiles(join(process.cwd(), 'src'))
    const failures = cssFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const checkedBlocks = [...source.matchAll(/MuiCheckbox-root\.Mui-checked[^{]*\{[^}]*\}/g)]

      return checkedBlocks
        .filter((match) => !/--mui-palette-primary-main|primary\.main/.test(match[0]))
        .map((match) => `${file}:${match.index ?? 0}: checked checkbox color must use primary`)
    })

    expect(failures).toEqual([])
  })

  it('[AC 8.29] [AC 7.13] keeps text inputs on shared clearable implementations', () => {
    const files = listTsxFiles(join(process.cwd(), 'src'))
    const failures = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const textFieldFailures = [...source.matchAll(/<TextField\b/g)]
        .filter((match) => {
          if (file.endsWith('src/shared/ClearableTextField.tsx')) {
            return false
          }

          const tagStart = match.index ?? 0
          const openingTag = source.slice(tagStart, source.indexOf('>', tagStart) + 1)
          const renderInputContext = source.slice(Math.max(0, tagStart - 120), tagStart)

          return (
            !/\bselect\b/.test(openingTag) &&
            !/\{\.\.\.params\}/.test(openingTag) &&
            !/renderInput/.test(renderInputContext)
          )
        })
        .map(
          (match) =>
            `${file}:${match.index ?? 0}: use ClearableTextField for non-select text fields`,
        )

      const rawInputFailures = [...source.matchAll(/<input\b/g)]
        .filter((match) => {
          const tagStart = match.index ?? 0
          const openingTag = source.slice(tagStart, source.indexOf('>', tagStart) + 1)
          const rawInputBlock = source.slice(tagStart, source.indexOf('/>', tagStart) + 2)

          if (/\btype=(?:"checkbox"|'checkbox'|"file"|'file')/.test(openingTag)) {
            return false
          }

          if (
            /\btype=(?:"range"|'range')/.test(openingTag) ||
            /\btype=(?:"range"|'range')/.test(rawInputBlock)
          ) {
            return false
          }

          const following = source.slice(tagStart, tagStart + 900)

          return !/(をクリア|clearButton|textControlClearButton|addEncodeClearButton)/.test(
            following,
          )
        })
        .map(
          (match) =>
            `${file}:${match.index ?? 0}: raw text input must expose an adjacent clear action`,
        )

      return [...textFieldFailures, ...rawInputFailures]
    })

    expect(failures).toEqual([])
  })
})
