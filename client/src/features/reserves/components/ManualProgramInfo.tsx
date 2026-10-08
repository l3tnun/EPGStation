import { resolveLegacyComponentDetails } from '@/features/guide/ProgramDialog'
import { formatManualProgramDate, manualProgramGenres } from '../lib/manualProgramFormat'
import type { ManualProgramDetail } from '../lib/reservesApiTypes'
import styles from '../ReservesPage.module.css'

export function ManualProgramInfo({ program }: { program: ManualProgramDetail }) {
  const programGenres = manualProgramGenres(program)
  const programComponentDetails = resolveLegacyComponentDetails(program)

  return (
    <section className={styles.manualProgramInfo} aria-label="番組情報">
      <h2 className={styles.manualProgramName}>{program.name}</h2>
      <div className={styles.manualProgramMeta}>
        {program.channelName ?? String(program.channelId)}
      </div>
      <div className={styles.manualProgramMeta}>{formatManualProgramDate(program)}</div>
      {programGenres.length === 0 ? undefined : (
        <div className={styles.manualProgramGenres}>
          {programGenres.map((genre) => (
            <div key={genre}>{genre}</div>
          ))}
        </div>
      )}
      {program.description === undefined ? undefined : (
        <div className={styles.manualProgramDescription}>{program.description}</div>
      )}
      {program.extended === undefined ? undefined : (
        <div className={styles.manualProgramDescription}>{program.extended}</div>
      )}
      {programComponentDetails.length === 0 ? undefined : (
        <div className={styles.manualProgramGenres}>
          {programComponentDetails.map((detail) => (
            <div key={detail}>{detail}</div>
          ))}
        </div>
      )}
      {program.isFree === undefined ? undefined : (
        <div className={styles.manualProgramMeta}>{program.isFree ? '無料放送' : '有料放送'}</div>
      )}
    </section>
  )
}
