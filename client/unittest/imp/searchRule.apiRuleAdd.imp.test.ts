import { describe, expect, it, vi } from 'vitest'
import { createFetchSearchRuleApiRepository } from '@/features/search/rule/api'

describe('SearchRule API repository', () => {
  it('uses App Shell bootstrap channels without issuing a second channels request', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/schedules/search') {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              name: 'Synthetic program',
              channelId: 101,
            },
          ]),
        )
      }

      throw new Error(`Unexpected fetch: ${String(input)}`)
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api' })

    repository.primeChannelIndex?.([{ id: 101, name: 'Bootstrap channel' }])

    await expect(repository.fetchSearchChannels?.(false)).resolves.toStrictEqual({
      ok: true,
      value: [{ id: 101, name: 'Bootstrap channel' }],
    })
    await expect(
      repository.searchSchedules({
        isHalfWidth: false,
        limit: 300,
        option: {
          keyword: 'Synthetic',
          keyCS: false,
          keyRegExp: false,
          name: true,
          description: true,
          extended: true,
          times: [{ week: 0x7f }],
        },
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: [
        expect.objectContaining({
          channelId: 101,
          channelName: 'Bootstrap channel',
        }),
      ],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/schedules/search', expect.any(Object))
  })

  it('posts rule add payload with source-compatible optional fields instead of null placeholders', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return new Response(JSON.stringify({ ruleId: 701 }), { status: 200 })
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api/' })

    await expect(
      repository.addRule({
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Synthetic Program',
          name: true,
          description: true,
          channelIds: [301],
          genres: [{ genre: 7, subGenre: 3 }],
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: 'Synthetic Program',
          recordedFormat: null,
        },
        encodeOption: {
          mode1: 'Synthetic Encode',
          encodeParentDirectoryName1: null,
          directory1: 'Synthetic Program',
          mode2: null,
          encodeParentDirectoryName2: null,
          directory2: null,
          mode3: null,
          encodeParentDirectoryName3: null,
          directory3: null,
          isDeleteOriginalAfterEncode: false,
        },
      }),
    ).resolves.toEqual({ ok: true, value: { ruleId: 701 } })

    expect(fetcher).toHaveBeenCalledWith('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Synthetic Program',
          name: true,
          description: true,
          channelIds: [301],
          genres: [{ genre: 7, subGenre: 3 }],
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
        },
        saveOption: {
          directory: 'Synthetic Program',
        },
        encodeOption: {
          mode1: 'Synthetic Encode',
          directory1: 'Synthetic Program',
          isDeleteOriginalAfterEncode: false,
        },
      }),
    })
  })

  it('omits display-only channelNames from rule add and update request bodies', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return new Response(JSON.stringify({ ruleId: 701 }), { status: 200 })
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api' })
    const payload = {
      isTimeSpecification: false,
      searchOption: {
        keyword: 'Synthetic Program',
        name: true,
        channelIds: [301],
        channelNames: ['Synthetic Rule Channel'],
        times: [{ week: 0x7f }],
      },
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
      saveOption: {
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
      },
    }

    await repository.addRule(payload)
    await repository.updateRule(701, payload)

    const addBody = JSON.parse(
      String((fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { searchOption: Record<string, unknown> }
    const updateBody = JSON.parse(
      String((fetcher.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
    ) as { searchOption: Record<string, unknown> }

    expect(addBody.searchOption).not.toHaveProperty('channelNames')
    expect(updateBody.searchOption).not.toHaveProperty('channelNames')
  })
})
