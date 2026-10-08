import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { SettingsValidator } from '@/shared/settings/settingsValidation'
import { SETTINGS_STORAGE_KEY } from '@/shared/settings'

export interface PwaSettings {
  isEnablePWA: boolean
}

export interface PwaStartupDocument {
  document: Document
  serviceWorker?: Pick<ServiceWorkerContainer, 'register'>
}

function readRawSettings(storage: Storage): string | null {
  try {
    return storage.getItem(SETTINGS_STORAGE_KEY)
  } catch {
    return null
  }
}

export function readPwaSettingsSnapshot(storage: Storage): PwaSettings {
  const defaults = new DefaultSettingsFactory().create()
  const validator = new SettingsValidator(defaults)
  const loaded = validator.parse(readRawSettings(storage))

  return {
    isEnablePWA: loaded.value.isEnablePWA,
  }
}

function removeAll(document: Document, selector: string): void {
  document.querySelectorAll(selector).forEach((element) => {
    element.remove()
  })
}

export function applyPwaStartupSettings(
  settings: PwaSettings,
  environment: PwaStartupDocument,
): void {
  if (settings.isEnablePWA) {
    environment.serviceWorker
      ?.register('./serviceWorker.js')
      .then((registration) => {
        if (typeof registration.update === 'function') {
          registration.update()
        }
      })
      .catch((error: unknown) => {
        console.log(`Error Log: ${String(error)}`)
      })

    return
  }

  removeAll(environment.document, 'link[rel="manifest"]')
  removeAll(environment.document, 'meta[name="apple-mobile-web-app-title"]')
  removeAll(environment.document, 'meta[name="apple-mobile-web-app-capable"]')
  removeAll(environment.document, 'meta[name="apple-mobile-web-app-status-bar-style"]')
  removeAll(environment.document, 'meta[name="mobile-web-app-capable"]')
  removeAll(environment.document, 'link[rel="apple-touch-icon-precomposed"]')
}
