import { AdjacentStorageRegistry } from '@/shared/settings'
import { replaceURLSchemePlaceholders, resolveURLSchemeTemplate } from '@/shared/settings/urlScheme'
import {
  adjacentStorageFixtures,
  assertSyntheticSettingsFixture,
  settingsStorageStateMatrix,
} from '@/shared/settings/__fixtures__/settingsStorageFixtures'

describe('AdjacentStorageRegistry implementation edges', () => {
  it('returns isolated definitions so consumer mutation does not affect later lookups', () => {
    const registry = new AdjacentStorageRegistry()
    const listedDefinition = registry.list()[0]
    const foundDefinition = registry.find('RecordedSelectStreamSetting')

    listedDefinition.owner = '<mutated-owner>'
    if (foundDefinition.defaultValue !== null) {
      foundDefinition.defaultValue.type = '<mutated-type>'
    }

    expect(registry.list()[0]).toMatchObject({
      key: 'OnAirSelectStreamSetting',
      owner: 'frontend-onair',
      defaultValue: { useURLScheme: false, type: 'M2TS', mode: 0 },
    })
    expect(registry.find('RecordedSelectStreamSetting')).toMatchObject({
      key: 'RecordedSelectStreamSetting',
      owner: 'frontend-recorded',
      defaultValue: { type: 'WebM', mode: 0 },
    })
  })
})

describe('URL scheme utility implementation edges', () => {
  it('replaces every supported placeholder occurrence and leaves unsupported text untouched', () => {
    expect(
      replaceURLSchemePlaceholders('PROTOCOL://ADDRESS/path/ADDRESS/file/FILENAME?raw=TOKEN', {
        protocol: '<protocol>',
        address: '<address>',
        filename: '<filename>',
      }),
    ).toBe('<protocol>://<address>/path/<address>/file/<filename>?raw=TOKEN')
  })

  it('resolves null, empty, and whitespace-only saved schemes to the consumer fallback template', () => {
    expect(resolveURLSchemeTemplate(null, '<fallback-template>')).toBe('<fallback-template>')
    expect(resolveURLSchemeTemplate('', '<fallback-template>')).toBe('<fallback-template>')
    expect(resolveURLSchemeTemplate('   ', '<fallback-template>')).toBe('<fallback-template>')
    expect(resolveURLSchemeTemplate('<saved-template>', '<fallback-template>')).toBe(
      '<saved-template>',
    )
  })

  it('throws instead of silently leaving FILENAME unresolved when filename is missing at runtime', () => {
    expect(() =>
      replaceURLSchemePlaceholders('player://PROTOCOL/ADDRESS/FILENAME', {
        protocol: '<protocol>',
        address: '<address>',
      } as unknown as Parameters<typeof replaceURLSchemePlaceholders>[1]),
    ).toThrow('Missing URL scheme placeholder value: FILENAME')
  })
})

describe('Synthetic fixture implementation safety', () => {
  it('rejects non-synthetic fixture values', () => {
    for (const fixture of settingsStorageStateMatrix) {
      expect(() => assertSyntheticSettingsFixture(fixture)).not.toThrow()
    }
    expect(() => assertSyntheticSettingsFixture(adjacentStorageFixtures)).not.toThrow()
  })
})
