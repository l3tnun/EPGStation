import { describe, expect, it, vi } from 'vitest'
import { createFetchSearchRuleApiRepository } from '@/features/search/rule/api'

describe('SearchRule API repository', () => {
  it('fetches rule detail and time-specified rule reserves for edit preload', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/rules/55') {
        return new Response(
          JSON.stringify({
            id: 55,
            isTimeSpecification: true,
            searchOption: {
              channelIds: [33],
              times: [{ week: 0x7f }],
            },
            reserveOption: {
              enable: true,
              allowEndLack: true,
              avoidDuplicate: true,
              periodToAvoidDuplicate: null,
            },
            saveOption: {
              parentDirectoryName: null,
              directory: 'Synthetic Directory',
              recordedFormat: null,
            },
          }),
          { status: 200 },
        )
      }
      if (url === '/api/channels') {
        return new Response(JSON.stringify([{ id: 33, halfWidthName: 'Synthetic Rule Channel' }]), {
          status: 200,
        })
      }
      if (url === '/api/reserves?type=all&ruleId=55&isHalfWidth=true') {
        return new Response(
          JSON.stringify({
            reserves: [
              {
                id: 801,
                name: 'Synthetic Rule Reserve',
                channelName: 'Synthetic Channel',
                isTimeSpecified: true,
              },
            ],
          }),
          { status: 200 },
        )
      }

      return new Response(null, { status: 404 })
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchRule(55, false)).resolves.toEqual({
      ok: true,
      value: {
        id: 55,
        isTimeSpecification: true,
        searchOption: {
          channelIds: [33],
          channelNames: ['Synthetic Rule Channel'],
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: true,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: 'Synthetic Directory',
          recordedFormat: null,
        },
      },
    })
    await expect(repository.fetchRuleReserves({ ruleId: 55, isHalfWidth: true })).resolves.toEqual({
      ok: true,
      value: [
        {
          id: 801,
          name: 'Synthetic Rule Reserve',
          channelName: 'Synthetic Channel',
          isTimeSpecified: true,
        },
      ],
    })
  })

  it('loads source-compatible rule details that omit saveOption', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/rules/399') {
        return new Response(
          JSON.stringify({
            id: 399,
            isTimeSpecification: false,
            searchOption: {
              keyword: 'Synthetic Existing Rule',
              name: true,
              description: true,
              channelIds: [3273601024],
              genres: [{ genre: 5, subGenre: 2 }],
              times: [{ week: 0x7f }],
            },
            reserveOption: {
              enable: true,
              allowEndLack: true,
              avoidDuplicate: false,
            },
          }),
          { status: 200 },
        )
      }
      if (url === '/api/channels') {
        return new Response(JSON.stringify([]), { status: 200 })
      }

      return new Response(null, { status: 404 })
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchRule(399, false)).resolves.toEqual({
      ok: true,
      value: {
        id: 399,
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Synthetic Existing Rule',
          name: true,
          description: true,
          channelIds: [3273601024],
          channelNames: ['3273601024'],
          genres: [{ genre: 5, subGenre: 2 }],
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
      },
    })
  })

  it('fetches rule list and runs rule item actions', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/rules?type=normal&offset=25&limit=25&isHalfWidth=false&keyword=Synthetic') {
        return new Response(
          JSON.stringify({
            rules: [
              {
                id: 901,
                searchOption: {
                  keyword: 'Synthetic Rule',
                  times: [{ week: 0x7f }],
                },
                reserveOption: {
                  enable: true,
                  allowEndLack: true,
                  avoidDuplicate: false,
                  periodToAvoidDuplicate: null,
                },
                reservesCnt: 4,
              },
            ],
            total: 1,
          }),
          { status: 200 },
        )
      }
      if (url === '/api/rules/901/enable' && init?.method === 'PUT') {
        return new Response(null, { status: 204 })
      }
      if (url === '/api/rules/901/disable' && init?.method === 'PUT') {
        return new Response(null, { status: 204 })
      }
      if (url === '/api/rules/901' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }

      return new Response(null, { status: 404 })
    })
    const repository = createFetchSearchRuleApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchRules({
        type: 'normal',
        offset: 25,
        limit: 25,
        isHalfWidth: false,
        keyword: 'Synthetic',
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        rules: [
          {
            id: 901,
            searchOption: {
              keyword: 'Synthetic Rule',
              times: [{ week: 0x7f }],
            },
            reserveOption: {
              enable: true,
              allowEndLack: true,
              avoidDuplicate: false,
              periodToAvoidDuplicate: null,
            },
            reservesCnt: 4,
          },
        ],
        total: 1,
      },
    })
    await expect(repository.enableRule(901)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.disableRule(901)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.deleteRule(901)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
  })
})
