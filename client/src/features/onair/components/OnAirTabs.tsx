import type { BroadcastWave } from '@/app/navigation'
import styles from '../OnAirPage.module.css'

function scrollWindowToTop(): void {
  const scroll = window.scroll as typeof window.scroll & { mock?: unknown }
  if (navigator.userAgent.includes('jsdom') && scroll.mock === undefined) {
    return
  }

  scroll(0, 0)
}

/** Broadcast wave tabs shown in the title bar when the tab list view is enabled. */
export function OnAirTabs({
  tabs,
  selectedTab,
  onSelect,
}: {
  tabs: readonly BroadcastWave[]
  selectedTab: BroadcastWave
  onSelect: (tab: BroadcastWave) => void
}) {
  return (
    <div aria-label="放送波" className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={selectedTab === tab}
          className={styles.tab}
          key={tab}
          onClick={() => {
            onSelect(tab)
            scrollWindowToTop()
          }}
          role="tab"
          style={selectedTab === tab ? { borderBottomColor: '#fff', color: '#fff' } : undefined}
          type="button"
          value={tab}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
