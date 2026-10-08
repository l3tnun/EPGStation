import type { RecordedListItem } from '@/features/recorded/recordedApi'
import styles from '../PlaybackPage.module.css'

function formatRecordedWatchTime(item: RecordedListItem): string {
  if (item.startAt === undefined || item.endAt === undefined) {
    return ''
  }
  const start = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(item.startAt))
  const end = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(item.endAt))

  return `${start} ~ ${end}`
}

export function RecordedWatchInfoCard({ item }: { item: RecordedListItem }) {
  const timeText = formatRecordedWatchTime(item)

  return (
    <div className={styles.infoCardWrap} data-testid="recorded-watch-info-card">
      <article className={styles.infoCard}>
        {item.channelName === undefined ? undefined : <div>{item.channelName}</div>}
        {timeText === '' ? undefined : <div className={styles.infoCardTime}>{timeText}</div>}
        <div className={styles.infoCardTitle}>{item.name ?? ''}</div>
        {item.description === undefined ? undefined : (
          <div className={styles.infoCardDescription}>{item.description}</div>
        )}
      </article>
    </div>
  )
}
