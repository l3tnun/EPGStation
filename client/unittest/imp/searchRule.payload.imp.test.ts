import { describe, expect, it } from 'vitest'
import {
  buildSearchRequestBody,
  buildSearchRulePayload,
  createDefaultSearchFormState,
} from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Search rule payload builder', () => {
  it('builds rule add payload from current search request and settings defaults', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isCheckAvoidDuplicate: true,
      isCheckDeleteOriginalAfterEncode: true,
      isEnableCopyKeywordToDirectory: true,
      isEnableEncodingSettingWhenCreateRule: true,
    }
    const form = {
      ...createDefaultSearchFormState(['GR']),
      keyword: 'Synthetic Rule',
    }
    const searchBody = buildSearchRequestBody({ form, settings })

    expect(
      buildSearchRulePayload({
        searchBody,
        settings,
        encodeModes: ['Synthetic Encode'],
      }),
    ).toEqual({
      isTimeSpecification: false,
      searchOption: searchBody.option,
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: true,
        periodToAvoidDuplicate: null,
      },
      saveOption: {
        parentDirectoryName: null,
        directory: 'Synthetic Rule',
        recordedFormat: null,
      },
      encodeOption: {
        mode1: 'Synthetic Encode',
        encodeParentDirectoryName1: null,
        directory1: 'Synthetic Rule',
        mode2: null,
        encodeParentDirectoryName2: null,
        directory2: null,
        mode3: null,
        encodeParentDirectoryName3: null,
        directory3: null,
        isDeleteOriginalAfterEncode: true,
      },
    })
  })

  it('omits encode option when all encode modes are null', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isEnableEncodingSettingWhenCreateRule: false,
    }
    const searchBody = buildSearchRequestBody({
      form: createDefaultSearchFormState(['GR']),
      settings,
    })

    expect(buildSearchRulePayload({ searchBody, settings, encodeModes: [] })).not.toHaveProperty(
      'encodeOption',
    )
  })

  it('uses edited rule option fields instead of settings defaults', () => {
    const settings = new DefaultSettingsFactory().create()
    const searchBody = buildSearchRequestBody({
      form: {
        ...createDefaultSearchFormState(['GR']),
        keyword: 'Edited Rule',
      },
      settings,
    })

    expect(
      buildSearchRulePayload({
        searchBody,
        settings,
        encodeModes: ['Default Encode'],
        optionDraft: {
          reserveOption: {
            enable: false,
            allowEndLack: false,
            avoidDuplicate: true,
            periodToAvoidDuplicate: 5,
          },
          saveOption: {
            parentDirectoryName: 'recorded-root',
            directory: 'edited-directory',
            recordedFormat: 'edited-format',
          },
          encodeOption: {
            mode1: 'Encode 1',
            encodeParentDirectoryName1: 'encode-root-1',
            directory1: 'encode-sub-1',
            mode2: 'Encode 2',
            encodeParentDirectoryName2: 'encode-root-2',
            directory2: 'encode-sub-2',
            mode3: 'Encode 3',
            encodeParentDirectoryName3: 'encode-root-3',
            directory3: 'encode-sub-3',
            isDeleteOriginalAfterEncode: true,
          },
        },
      }),
    ).toMatchObject({
      reserveOption: {
        enable: false,
        allowEndLack: false,
        avoidDuplicate: true,
        periodToAvoidDuplicate: 5,
      },
      saveOption: {
        parentDirectoryName: 'recorded-root',
        directory: 'edited-directory',
        recordedFormat: 'edited-format',
      },
      encodeOption: {
        mode1: 'Encode 1',
        encodeParentDirectoryName2: 'encode-root-2',
        directory2: 'encode-sub-2',
        mode3: 'Encode 3',
        encodeParentDirectoryName3: 'encode-root-3',
        directory3: 'encode-sub-3',
        isDeleteOriginalAfterEncode: true,
      },
    })
  })
})
