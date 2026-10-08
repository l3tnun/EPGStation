import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LiveStreamSelectChannel } from '@/features/onair/LiveStreamSelectDialog'

/** Open/close state of every Guide overlay; all of them close when the route changes. */
export function useGuideDialogState(routeKey: string) {
  const [dayDialogOpen, setDayDialogOpen] = useState(false)
  const [timeMenuAnchor, setTimeMenuAnchor] = useState<HTMLElement | null>(null)
  const [mainMenuAnchor, setMainMenuAnchor] = useState<HTMLElement | null>(null)
  const [genreDialogOpen, setGenreDialogOpen] = useState(false)
  const [programDialogOpen, setProgramDialogOpen] = useState(false)
  const [streamDialogChannel, setStreamDialogChannel] = useState<LiveStreamSelectChannel | null>(
    null,
  )
  const [selectedProgramId, setSelectedProgramId] = useState<number | undefined>(undefined)
  const genreDialogOpenTimer = useRef<number | undefined>(undefined)

  const closeMainMenu = () => {
    setMainMenuAnchor(null)
  }
  const openGenreDialogAfterDelay = () => {
    closeMainMenu()
    window.clearTimeout(genreDialogOpenTimer.current)
    // v2's `GuideMainMenu.vue` `genreSetting()` closes the menu, then `await Util.sleep(300)`
    // before opening the genre dialog - this lets the menu's own closing transition finish
    // before the dialog's backdrop starts covering the screen. Measuring the actual MUI Menu
    // close transition confirmed it takes close to 300ms, and opening the dialog immediately (as
    // a 0ms delay does) visibly overlaps the closing menu with the newly opened dialog.
    genreDialogOpenTimer.current = window.setTimeout(() => {
      setGenreDialogOpen(true)
      genreDialogOpenTimer.current = undefined
    }, 300)
  }

  useEffect(() => {
    const closeTimer = setTimeout(() => {
      setDayDialogOpen(false)
      setTimeMenuAnchor(null)
      setGenreDialogOpen(false)
      setProgramDialogOpen(false)
      setStreamDialogChannel(null)
      setMainMenuAnchor(null)
    }, 0)

    return () => {
      clearTimeout(closeTimer)
      window.clearTimeout(genreDialogOpenTimer.current)
    }
  }, [routeKey])

  useLayoutEffect(
    () => () => {
      window.clearTimeout(genreDialogOpenTimer.current)
    },
    [],
  )

  return {
    dayDialogOpen,
    setDayDialogOpen,
    timeMenuAnchor,
    setTimeMenuAnchor,
    mainMenuAnchor,
    setMainMenuAnchor,
    closeMainMenu,
    genreDialogOpen,
    setGenreDialogOpen,
    openGenreDialogAfterDelay,
    programDialogOpen,
    setProgramDialogOpen,
    streamDialogChannel,
    setStreamDialogChannel,
    selectedProgramId,
    setSelectedProgramId,
  }
}
