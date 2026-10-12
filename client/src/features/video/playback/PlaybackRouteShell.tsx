import type { ReactNode } from 'react'
import { SHELL_NAVIGATION_DRAWER_ID } from '@/app/AppShell'
import { TitleBar } from '@/app/titleBar'
import styles from './PlaybackPage.module.css'

export interface PlaybackRouteShellProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  title: string
  children: ReactNode
}

export function PlaybackRouteShell({
  isNavigationOpen,
  onNavigationClick,
  title,
  children,
}: PlaybackRouteShellProps) {
  return (
    <>
      <TitleBar
        title={title}
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      <div className={styles.page}>
        <div className={styles.content}>{children}</div>
      </div>
    </>
  )
}

export function PlaybackControlledError({ message }: { message: string }) {
  return (
    <div className={styles.controlledError} data-testid="playback-controlled-error">
      {message}
    </div>
  )
}

export function PlaybackPendingState() {
  return (
    <div className={styles.controlledError} data-testid="playback-pending">
      読み込み中
    </div>
  )
}
