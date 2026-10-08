import type { MouseEvent } from 'react'
import type { GuideProgramDialogProgram } from '@/features/guide/ProgramDialog'
import type { LiveStreamSelectChannel } from '../LiveStreamSelectDialog'
import type { OnAirProgram, OnAirSchedule } from '../onairApi'
import { calculateOnAirProgress } from '../onairRequests'
import styles from '../OnAirPage.module.css'

function formatProgramTime(program: OnAirProgram | undefined): string {
  if (program?.startAt === undefined || program.endAt === undefined) {
    return ''
  }

  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  return `${formatter.format(new Date(program.startAt))} ~ ${formatter.format(
    new Date(program.endAt),
  )}`
}

function resolveCardKey(schedule: OnAirSchedule, index: number): string {
  return String(schedule.programs?.[0]?.id ?? schedule.channel?.id ?? index)
}

function findOnAirDialogProgram(schedule: OnAirSchedule): GuideProgramDialogProgram | null {
  const program = schedule.programs?.[0]

  if (program?.id === undefined) {
    return null
  }

  return {
    ...program,
    id: program.id,
    channelId: program.channelId ?? schedule.channel?.id,
    channelName: schedule.channel?.name,
  }
}

export function OnAirCard({
  schedule,
  now,
  onProgramDialogOpen,
  onStreamDialogOpen,
}: {
  schedule: OnAirSchedule
  now: number
  onProgramDialogOpen: (program: GuideProgramDialogProgram) => void
  onStreamDialogOpen: (channel: LiveStreamSelectChannel) => void
}) {
  const program = schedule.programs?.[0]
  const programId = program?.id
  const progress = calculateOnAirProgress({
    now,
    startAt: program?.startAt,
    endAt: program?.endAt,
  })
  const dialogProgram = findOnAirDialogProgram(schedule)
  const openProgramDialog = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    if (dialogProgram !== null) {
      onProgramDialogOpen(dialogProgram)
    }
  }
  const openStreamDialog = () => {
    if (schedule.channel?.id !== undefined) {
      onStreamDialogOpen({
        id: schedule.channel.id,
        name: schedule.channel.name ?? dialogProgram?.channelName,
      })
    }
  }

  return (
    <article
      className={styles.card}
      data-testid={programId === undefined ? undefined : `onair-card-${programId}`}
      onClick={openStreamDialog}
    >
      <div className={styles.cardInner}>
        <button
          className={styles.cardHeader}
          data-testid="onair-card-header"
          onClick={openProgramDialog}
          style={{ minHeight: 28 }}
          type="button"
        >
          <span className={styles.channelRow}>
            {schedule.channel?.hasLogoData === true && schedule.channel.id !== undefined ? (
              <>
                <img
                  alt={schedule.channel.name ?? ''}
                  className={styles.logo}
                  src={`./api/channels/${schedule.channel.id}/logo`}
                />
                <span className={styles.logoChannelName}>{schedule.channel.name ?? ''}</span>
              </>
            ) : (
              (schedule.channel?.name ?? '')
            )}
          </span>
        </button>
        <div data-testid={programId === undefined ? undefined : `onair-card-body-${programId}`}>
          <div className={styles.time}>{formatProgramTime(program)}</div>
          <div className={styles.programTitle}>{program?.name ?? ''}</div>
          <div className={styles.description}>{program?.description ?? ''}</div>
          <div className={styles.progressPadding}>
            <div
              aria-label="進行状況"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(progress)}
              className={styles.progressTrack}
              role="progressbar"
              style={{ backgroundColor: 'rgba(25, 118, 210, 0.3)' }}
            >
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

export function OnAirList({
  schedules,
  now,
  layout,
  onProgramDialogOpen,
  onStreamDialogOpen,
}: {
  schedules: readonly OnAirSchedule[]
  now: number
  layout: 'tabs' | 'list'
  onProgramDialogOpen: (program: GuideProgramDialogProgram) => void
  onStreamDialogOpen: (channel: LiveStreamSelectChannel) => void
}) {
  return (
    <div className={styles.page} data-onair-layout={layout} data-testid="onair-page">
      <div className={styles.list} data-centered-column="true" data-testid="onair-list">
        {schedules.map((schedule, index) => (
          <OnAirCard
            key={resolveCardKey(schedule, index)}
            now={now}
            schedule={schedule}
            onProgramDialogOpen={onProgramDialogOpen}
            onStreamDialogOpen={onStreamDialogOpen}
          />
        ))}
      </div>
    </div>
  )
}
