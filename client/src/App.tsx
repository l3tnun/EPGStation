import { AppRoot } from './app/AppRoot'
import type { AppProps } from './app/appProps'

export type { AppProps } from './app/appProps'
export { MOBILE_NAVIGATION_CLICK_DELAY_MS } from './app/appProps'

function App(props: AppProps) {
  return <AppRoot {...props} />
}

export default App
