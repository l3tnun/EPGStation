import type { ServerApiFetch } from '@/app/serverApi'

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

export async function fetchJsonWithInit(
  fetcher: ServerApiFetch,
  url: string,
  init: RequestInit,
): Promise<unknown | null> {
  try {
    const response = await fetcher(url, init)

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}

export async function fetchText(fetcher: ServerApiFetch, url: string): Promise<string | null> {
  try {
    const response = await fetcher(url)

    if (!response.ok) {
      return null
    }

    return await response.text()
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
