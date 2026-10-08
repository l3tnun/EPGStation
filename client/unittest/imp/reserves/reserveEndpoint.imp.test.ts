import { describe, expect, it } from 'vitest'
import { buildReserveEndpointUrl, buildReservePath } from '@/features/reserves/lib/reserveEndpoint'

describe('reserveEndpoint URL builders', () => {
  it('omits the "?" separator when no query parameters are supplied', () => {
    expect(buildReserveEndpointUrl('/api', '/reserves', new URLSearchParams())).toBe(
      '/api/reserves',
    )
  })

  it('appends the query string when parameters are supplied', () => {
    const parameters = new URLSearchParams({ type: 'normal' })

    expect(buildReserveEndpointUrl('/api', '/reserves', parameters)).toBe(
      '/api/reserves?type=normal',
    )
  })

  it('omits the "?" separator for a bare path when no query parameters are supplied', () => {
    expect(buildReservePath('/guide', new URLSearchParams())).toBe('/guide')
  })

  it('appends the query string to a bare path when parameters are supplied', () => {
    const parameters = new URLSearchParams({ type: 'GR' })

    expect(buildReservePath('/guide', parameters)).toBe('/guide?type=GR')
  })
})
