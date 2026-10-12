import { expect } from 'vitest'

export function expectHashRoute(expectedHash: string): void {
  if (expectedHash === '#/' || expectedHash === '#') {
    expect(window.location.hash).toBe(expectedHash)
    return
  }

  const actual = parseHashRoute(window.location.hash)
  const expected = parseHashRoute(expectedHash)

  expect(actual.path).toBe(expected.path)
  expect(actual.parameters.get('timestamp')).toEqual(expect.stringMatching(/^\d+$/))

  actual.parameters.delete('timestamp')
  expected.parameters.delete('timestamp')
  expect(actual.parameters.toString()).toBe(expected.parameters.toString())
}

function parseHashRoute(hash: string): { path: string; parameters: URLSearchParams } {
  const route = hash.replace(/^#/, '')
  const [path, query = ''] = route.split('?')
  return { path, parameters: new URLSearchParams(query) }
}
