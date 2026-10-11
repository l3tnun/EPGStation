import { describe, expect, it } from 'vitest'
import { createFetchStoragesApiRepository } from '@/features/storages/storagesApi'
import { STORAGES_FAILURE_MESSAGE } from '@/features/storages/storagesRequests'

const failure = {
  ok: false,
  error: 'storages-fetch-failed',
  message: STORAGES_FAILURE_MESSAGE,
}

const validItem = { name: 'disk', available: 1, used: 2, total: 3 }

function fetchWith(payload: unknown, ok = true) {
  return createFetchStoragesApiRepository({
    fetcher: async () => ({ ok, json: async () => payload }) as Response,
  }).fetchStorages()
}

describe('Storages API payload validation', () => {
  it('accepts zero as a size and returns the items as received', async () => {
    const zero = { name: 'empty', available: 0, used: 0, total: 0 }

    await expect(fetchWith({ items: [validItem, zero] })).resolves.toStrictEqual({
      ok: true,
      value: { items: [validItem, zero] },
    })
  })

  it('rejects an item whose name is not a string', async () => {
    await expect(fetchWith({ items: [{ ...validItem, name: 1 }] })).resolves.toStrictEqual(failure)
  })

  it.each(['available', 'used', 'total'] as const)(
    'rejects an item whose %s is negative, not a number or not finite',
    async (field) => {
      for (const bad of [-1, '1', null, Number.POSITIVE_INFINITY, Number.NaN]) {
        await expect(fetchWith({ items: [{ ...validItem, [field]: bad }] })).resolves.toStrictEqual(
          failure,
        )
      }
    },
  )

  it('rejects a payload that is not an object with an items array, or an item that is not an object', async () => {
    await expect(fetchWith(null)).resolves.toStrictEqual(failure)
    await expect(fetchWith('text')).resolves.toStrictEqual(failure)
    await expect(fetchWith({})).resolves.toStrictEqual(failure)
    await expect(fetchWith({ items: 'x' })).resolves.toStrictEqual(failure)
    await expect(fetchWith({ items: [null] })).resolves.toStrictEqual(failure)
    await expect(fetchWith({ items: [validItem, 'x'] })).resolves.toStrictEqual(failure)
  })

  it('reports a failure for a non-success status or a body that cannot be read', async () => {
    await expect(fetchWith({ items: [validItem] }, false)).resolves.toStrictEqual(failure)
    await expect(
      createFetchStoragesApiRepository({
        fetcher: async () =>
          ({
            ok: true,
            json: async () => {
              throw new Error('invalid json')
            },
          }) as unknown as Response,
      }).fetchStorages(),
    ).resolves.toStrictEqual(failure)
  })
})
