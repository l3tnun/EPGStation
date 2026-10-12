import { useEffect, useState } from 'react'
import type { GuideGenreVisibility } from '../GuideGridRenderer'
import {
  isGuideGenreStorageKey,
  readGuideGenreVisibility,
  writeGuideGenreVisibility,
} from '../guideStorage'
import { getBrowserLocalStorage } from '../lib/guidePageState'

/** Genre visibility persisted in localStorage and refreshed when another tab changes it. */
export function useGuideGenreVisibility(): [
  GuideGenreVisibility,
  (visibility: GuideGenreVisibility) => void,
] {
  const [genreVisibility, setGenreVisibility] = useState<GuideGenreVisibility>(() =>
    readGuideGenreVisibility(getBrowserLocalStorage()),
  )

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (isGuideGenreStorageKey(event.key)) {
        setGenreVisibility(readGuideGenreVisibility(getBrowserLocalStorage()))
      }
    }

    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const saveGenreVisibility = (nextVisibility: GuideGenreVisibility) => {
    writeGuideGenreVisibility(getBrowserLocalStorage(), nextVisibility)
    setGenreVisibility(nextVisibility)
  }

  return [genreVisibility, saveGenreVisibility]
}
