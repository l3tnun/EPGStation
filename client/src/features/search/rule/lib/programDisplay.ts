import type { GuideProgramDialogProgram } from '@/features/guide/ProgramDialog'
import type { SearchProgram } from '../api'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function programName(program: SearchProgram): string {
  return program.name ?? `#${program.id}`
}

export function programMeta(program: SearchProgram): string {
  const channel =
    program.channelName ??
    (program.channelId === undefined ? undefined : `channel ${program.channelId}`)
  if (program.startAt === undefined || program.endAt === undefined) {
    return channel ?? ''
  }

  const start = new Date(program.startAt)
  const end = new Date(program.endAt)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const duration = Math.max(0, Math.round((program.endAt - program.startAt) / 60000))
  const range = `${pad2(start.getMonth() + 1)}/${pad2(start.getDate())}(${weekdays[start.getDay()]}) ${pad2(start.getHours())}:${pad2(start.getMinutes())} ~ ${pad2(end.getHours())}:${pad2(end.getMinutes())} (${duration}分)`

  return channel === undefined ? range : `${channel}\n${range}`
}

export function toDialogProgram(program: SearchProgram): GuideProgramDialogProgram {
  return {
    ...program,
    id: program.id,
  }
}

export function createReserveIndexRequest(
  programs: readonly SearchProgram[] | null,
): { startAt: number; endAt: number } | null {
  if (programs === null || programs.length === 0) {
    return null
  }

  const starts = programs.flatMap((program) =>
    program.startAt === undefined ? [] : [program.startAt],
  )
  const ends = programs.flatMap((program) => (program.endAt === undefined ? [] : [program.endAt]))

  if (starts.length === 0 || ends.length === 0) {
    return null
  }

  return {
    startAt: Math.min(...starts),
    endAt: Math.max(...ends),
  }
}
