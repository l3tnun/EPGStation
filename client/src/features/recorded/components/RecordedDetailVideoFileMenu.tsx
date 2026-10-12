import Button from '@mui/material/Button'
import Popover from '@mui/material/Popover'
import { useState } from 'react'
import type { RecordedHandoffVideoFile } from '../recordedRequests'
import styles from '../RecordedPage.module.css'
import { videoFileId } from '../lib/recordedFormat'

export function RecordedDetailVideoFileMenu({
  title,
  icon,
  files,
  onSelect,
  hrefForFile,
}: {
  title: string
  icon: string
  files: readonly RecordedHandoffVideoFile[]
  onSelect: (file: RecordedHandoffVideoFile) => void
  hrefForFile?: (file: RecordedHandoffVideoFile) => string | undefined
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)

  return (
    <>
      <Button
        className={styles.detailPrimaryAction}
        data-recorded-detail-action={title}
        type="button"
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <span className={styles.detailActionIcon} aria-hidden="true">
          {icon}
        </span>
        {title}
      </Button>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
      >
        <div className={styles.detailVideoMenu}>
          {files.map((file) => {
            const id = videoFileId(file)
            const href = hrefForFile?.(file)
            if (href !== undefined) {
              return (
                <a key={id ?? file.name} className={styles.detailVideoMenuButton} href={href}>
                  {file.name ?? `#${id ?? ''}`}
                </a>
              )
            }

            return (
              <Button
                key={id ?? file.name}
                className={styles.detailVideoMenuButton}
                type="button"
                onClick={() => {
                  close()
                  onSelect(file)
                }}
              >
                {file.name ?? `#${id ?? ''}`}
              </Button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}
