import { useEffect } from 'react'
import type { Location } from 'react-router-dom'
import { resolveIOSAddressBarFixClass } from '../lib/serverConfigSelectors'

export function useIOSAddressBarFix(location: Location, viewportWidth: number): void {
  useEffect(() => {
    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `document` */
    if (typeof document === 'undefined') {
      return () => undefined
    }

    const fixClass = resolveIOSAddressBarFixClass()

    document.documentElement.classList.remove('fix-address-bar', 'fix-address-bar2')
    document.documentElement.style.overflow = ''

    if (fixClass !== null) {
      document.documentElement.classList.add(fixClass)
    }

    return () => {
      document.documentElement.classList.remove('fix-address-bar', 'fix-address-bar2')
      document.documentElement.style.overflow = ''
    }
  }, [location, viewportWidth])
}
