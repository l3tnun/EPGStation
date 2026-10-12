import type { ServerApiFetch } from '@/app/serverApi'

export function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

export async function fetchJson(fetcher: ServerApiFetch, url: string): Promise<unknown | null> {
  try {
    const response = await fetcher(url)

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}

export async function fetchAction(
  fetcher: ServerApiFetch,
  url: string,
  init: RequestInit,
): Promise<boolean> {
  try {
    const response = await fetcher(url, init)

    return response.ok
  } catch {
    return false
  }
}

export async function fetchJsonAction(
  fetcher: ServerApiFetch,
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetcher(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return null
    }

    if (response.status === 204) {
      return {
        status: response.status,
        body: null,
      }
    }

    return {
      status: response.status,
      body: await response.json(),
    }
  } catch {
    return null
  }
}
