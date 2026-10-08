import { useMemo } from 'react'
import { linkifyGuideProgramExtendedText } from '../guideRequests'
import {
  formatLegacyProgramTime,
  resolveLegacyComponentDetails,
  resolveLegacyGenres,
} from '../lib/programDialogText'
import type { GuideProgramDialogProgram } from '../ProgramDialog'
import styles from '../GuidePage.module.css'

/** Title, channel, time, genres, description, extended text, and component details. */
export function ProgramDialogBody({
  program,
  title,
}: {
  program: GuideProgramDialogProgram
  title: string
}) {
  const legacyTime = formatLegacyProgramTime(program)
  const legacyGenres = resolveLegacyGenres(program)
  const legacyComponentDetails = resolveLegacyComponentDetails(program)
  const extendedTokens = useMemo(
    () => linkifyGuideProgramExtendedText(program.extended),
    [program.extended],
  )

  return (
    <>
      <div id="guide-program-dialog-title" className={styles.programDialogTitle}>
        {title}
      </div>
      {program.channelName !== undefined ? (
        <div className={styles.programSubText}>{program.channelName}</div>
      ) : undefined}
      {legacyTime !== null ? <div className={styles.programSubText}>{legacyTime}</div> : undefined}
      {legacyGenres.length === 0 ? undefined : (
        <div className={styles.programGenreList}>
          {legacyGenres.map((genre) => (
            <div key={genre}>{genre}</div>
          ))}
        </div>
      )}
      {program.description !== undefined ? (
        <p className={styles.programDescription}> {program.description} </p>
      ) : undefined}
      {extendedTokens.length === 0 ? undefined : (
        <p className={styles.programExtended} data-testid="guide-program-extended">
          {' '}
          {extendedTokens.map((token, index) =>
            token.type === 'link' ? (
              <a
                key={`${token.href}-${index}`}
                href={token.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {token.text}
              </a>
            ) : (
              <span key={`${token.text}-${index}`}>{token.text}</span>
            ),
          )}{' '}
        </p>
      )}
      {legacyComponentDetails.length === 0 ? undefined : (
        <div className={styles.programSubText}>
          {legacyComponentDetails.map((detail) => (
            <div key={detail}> {detail}</div>
          ))}
        </div>
      )}
      <div className={styles.programSubText}>
        {' '}
        {program.isFree === true ? '無料放送' : '有料放送'}
      </div>
    </>
  )
}
