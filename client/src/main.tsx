import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { createSocketIoRealtimeConnector } from './app/realtime'
import { createFetchServerApiRepository } from './app/serverApi'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      apiRepository={createFetchServerApiRepository()}
      realtimeConnectionConnector={createSocketIoRealtimeConnector()}
    />
  </StrictMode>,
)
