import type { Page } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { createMswRequest, fulfillMswResponse } from './appShellMocks'
import {
  guideStartAt,
  hour,
  syntheticGuideDenseSchedules,
  syntheticGuideSchedules,
  syntheticOnAirSchedules,
  syntheticOnAirChannels,
} from './guideOnAirFixtures'

interface SyntheticGuideReserve {
  id: number
  reserveId: number
  programId: number
  ruleId?: number
}

interface SyntheticGuideReserveLists {
  normal: SyntheticGuideReserve[]
  conflicts: SyntheticGuideReserve[]
  skips: SyntheticGuideReserve[]
  overlaps: SyntheticGuideReserve[]
}

function createInitialReserveLists(): SyntheticGuideReserveLists {
  return {
    normal: [{ id: 9001, reserveId: 9001, programId: 4201, ruleId: 91 }],
    conflicts: [{ id: 9002, reserveId: 9002, programId: 4102, ruleId: 92 }],
    skips: [{ id: 9003, reserveId: 9003, programId: 4301, ruleId: 93 }],
    overlaps: [{ id: 9004, reserveId: 9004, programId: 4302, ruleId: 94 }],
  }
}

const reserveLists = createInitialReserveLists()

export function resetSyntheticGuideReserveLists(): void {
  const next = createInitialReserveLists()

  reserveLists.normal = next.normal
  reserveLists.conflicts = next.conflicts
  reserveLists.skips = next.skips
  reserveLists.overlaps = next.overlaps
}

export function reserveSyntheticGuideProgram(programId: number, reserveId = 9901): void {
  reserveLists.normal = [
    ...reserveLists.normal.filter((reserve) => reserve.programId !== programId),
    { id: reserveId, reserveId, programId },
  ]
}

export function deleteSyntheticGuideReserve(reserveId: number): void {
  reserveLists.normal = reserveLists.normal.filter((reserve) => reserve.id !== reserveId)
  reserveLists.conflicts = reserveLists.conflicts.filter((reserve) => reserve.id !== reserveId)
  reserveLists.skips = reserveLists.skips.filter((reserve) => reserve.id !== reserveId)
  reserveLists.overlaps = reserveLists.overlaps.filter((reserve) => reserve.id !== reserveId)
}

type MockMode = 'success' | 'empty' | 'failure'

export interface GuideOnAirMockOptions {
  guide?: MockMode
  dense?: boolean
  onAir?: MockMode
  streams?: MockMode
}

export interface GuideOnAirRealtimeMockOptions extends GuideOnAirMockOptions {
  onReserveMutation?: () => void
}

export interface GuideOnAirRealtimeMockController {
  renameOnAirProgram: (name: string) => void
  renameLiveStream: (name: string) => void
  clearGuideReserveIndex: () => void
}

function createGuideOnAirHandlers({
  guide = 'success',
  dense = false,
  onAir = 'success',
  streams = 'success',
}: GuideOnAirMockOptions = {}) {
  resetSyntheticGuideReserveLists()

  return [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/schedules/broadcasting'),
      () => {
        if (onAir === 'failure') {
          return HttpResponse.json({ error: 'synthetic-onair-failure' }, { status: 503 })
        }

        return HttpResponse.json(onAir === 'empty' ? [] : syntheticOnAirSchedules)
      },
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/schedules/301'),
      () => {
        if (guide === 'failure') {
          return HttpResponse.json({ error: 'synthetic-guide-failure' }, { status: 503 })
        }

        return HttpResponse.json(guide === 'empty' ? [] : syntheticGuideSchedules.slice(0, 1))
      },
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/schedules'),
      () => {
        if (guide === 'failure') {
          return HttpResponse.json({ error: 'synthetic-guide-failure' }, { status: 503 })
        }

        if (guide === 'empty') {
          return HttpResponse.json([])
        }

        return HttpResponse.json(dense ? syntheticGuideDenseSchedules : syntheticGuideSchedules)
      },
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/reserves/lists'),
      () => HttpResponse.json(reserveLists),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/channels'),
      () => HttpResponse.json(syntheticOnAirChannels),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/streams'),
      () => {
        if (streams === 'failure') {
          return HttpResponse.json({ error: 'synthetic-streams-failure' }, { status: 503 })
        }

        return HttpResponse.json({
          items: [
            {
              channelId: 301,
              mode: 0,
              type: 'webm',
              name: 'Synthetic OnAir News',
              description: 'Synthetic live stream description',
              startAt: guideStartAt,
              endAt: guideStartAt + hour,
            },
          ],
        })
      },
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/reserves/update'),
      () => HttpResponse.json({}),
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/reserves'),
      async ({ request }) => {
        const body = (await request.json().catch(() => undefined)) as
          | {
              programId?: unknown
            }
          | undefined

        if (typeof body?.programId === 'number') {
          reserveSyntheticGuideProgram(body.programId)
        }

        return HttpResponse.json({ reserveId: 9901 })
      },
    ),
    http.delete(
      ({ request }) =>
        /\/api\/reserves\/\d+(?:\/skip|\/overlap)?$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({}),
    ),
  ]
}

export async function installGuideOnAirApiMocks(
  page: Page,
  options?: GuideOnAirMockOptions,
): Promise<void> {
  const handlers = createGuideOnAirHandlers(options)

  await page.route('**/api/**', async (route) => {
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}

export async function installGuideOnAirRealtimeApiMocks(
  page: Page,
  options?: GuideOnAirRealtimeMockOptions,
): Promise<GuideOnAirRealtimeMockController> {
  let onAirProgramName = 'Synthetic OnAir News'
  let liveStreamName = 'Synthetic OnAir News'
  resetSyntheticGuideReserveLists()
  const handlers = [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/schedules/broadcasting'),
      () =>
        HttpResponse.json(
          syntheticOnAirSchedules.map((schedule, scheduleIndex) =>
            scheduleIndex === 0
              ? {
                  ...schedule,
                  programs: schedule.programs.map((program, programIndex) =>
                    programIndex === 0 ? { ...program, name: onAirProgramName } : program,
                  ),
                }
              : schedule,
          ),
        ),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/reserves/lists'),
      () => HttpResponse.json(reserveLists),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/channels'),
      () => HttpResponse.json(syntheticOnAirChannels),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/streams'),
      () =>
        HttpResponse.json({
          items: [
            {
              channelId: 301,
              mode: 0,
              type: 'webm',
              name: liveStreamName,
              description: 'Synthetic live stream description',
              startAt: guideStartAt,
              endAt: guideStartAt + hour,
            },
          ],
        }),
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/reserves'),
      async ({ request }) => {
        const body = (await request.json().catch(() => undefined)) as
          | {
              programId?: unknown
            }
          | undefined

        if (typeof body?.programId === 'number') {
          reserveSyntheticGuideProgram(body.programId)
        }
        options?.onReserveMutation?.()

        return HttpResponse.json({ reserveId: 9901 })
      },
    ),
    http.delete(
      ({ request }) =>
        /\/api\/reserves\/\d+(?:\/skip|\/overlap)?$/.test(new URL(request.url).pathname),
      ({ request }) => {
        const match = new URL(request.url).pathname.match(/\/api\/reserves\/(\d+)/)
        const reserveId = match === null ? NaN : Number(match[1])
        if (Number.isFinite(reserveId)) {
          deleteSyntheticGuideReserve(reserveId)
        }
        options?.onReserveMutation?.()

        return HttpResponse.json({})
      },
    ),
    ...createGuideOnAirHandlers(options),
  ]

  await page.route('**/api/**', async (route) => {
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })

  return {
    renameOnAirProgram: (name) => {
      onAirProgramName = name
    },
    renameLiveStream: (name) => {
      liveStreamName = name
    },
    clearGuideReserveIndex: () => {
      reserveLists.normal = []
      reserveLists.conflicts = []
      reserveLists.skips = []
      reserveLists.overlaps = []
    },
  }
}
