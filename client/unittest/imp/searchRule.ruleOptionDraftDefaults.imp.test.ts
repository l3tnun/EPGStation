import { describe, expect, it } from 'vitest'
import { createRuleOptionDraft } from '@/features/search/rule/lib/ruleOptionDraft'
import type { SearchRuleDetail } from '@/features/search/rule/lib/searchTypes'

function settings(overrides: Record<string, unknown> = {}): never {
  return {
    isEnableCopyKeywordToDirectory: false,
    isEnableEncodingSettingWhenCreateRule: false,
    isCheckAvoidDuplicate: false,
    isCheckDeleteOriginalAfterEncode: false,
    ...overrides,
  } as never
}

const searchBody = { option: { keyword: 'kw' } } as never

describe('searchRule rule option draft defaults', () => {
  it('leaves the first encode mode unset when encoding on rule creation is disabled', () => {
    const draft = createRuleOptionDraft({
      existingRule: null,
      searchBody,
      settings: settings({ isEnableCopyKeywordToDirectory: true }),
      encodeModes: ['mode-a', 'mode-b'],
    })

    expect(draft.saveOption.directory).toBe('kw')
    expect(draft.encodeOption?.mode1).toBeNull()
    expect(draft.encodeOption?.directory1).toBeNull()
  })

  it('selects the first encode mode and copies the keyword directory when enabled', () => {
    const draft = createRuleOptionDraft({
      existingRule: null,
      searchBody,
      settings: settings({
        isEnableCopyKeywordToDirectory: true,
        isEnableEncodingSettingWhenCreateRule: true,
      }),
      encodeModes: ['mode-a', 'mode-b'],
    })

    expect(draft.encodeOption?.mode1).toBe('mode-a')
    expect(draft.encodeOption?.directory1).toBe('kw')
  })

  it('has no encode option key at all when there are no encode modes', () => {
    const draft = createRuleOptionDraft({
      existingRule: null,
      searchBody,
      settings: settings({ isEnableEncodingSettingWhenCreateRule: true }),
      encodeModes: [],
    })

    expect(Object.keys(draft)).toEqual(['reserveOption', 'saveOption'])
  })

  it('copies the option of an existing rule and omits an absent encode option key', () => {
    const rule = {
      reserveOption: { enable: false },
      saveOption: { directory: 'd' },
    } as unknown as SearchRuleDetail

    const draft = createRuleOptionDraft({
      existingRule: rule,
      searchBody,
      settings: settings(),
      encodeModes: ['mode-a'],
    })

    expect(draft.reserveOption).toBe(rule.reserveOption)
    expect(draft.saveOption).toBe(rule.saveOption)
    expect(Object.keys(draft)).toEqual(['reserveOption', 'saveOption'])
  })

  it('keeps the encode option of an existing rule', () => {
    const encodeOption = { mode1: 'x' }
    const rule = {
      reserveOption: {},
      saveOption: {},
      encodeOption,
    } as unknown as SearchRuleDetail

    const draft = createRuleOptionDraft({
      existingRule: rule,
      searchBody,
      settings: settings(),
      encodeModes: [],
    })

    expect(draft.encodeOption).toBe(encodeOption)
  })
})
