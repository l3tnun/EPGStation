import {
  SettingsStorageRepository,
  type SettingsConsumerValue,
  type SettingsSaveResult,
} from '@/shared/settings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createDefaultSettingsInputFromNavigator } from '@/shared/settings/platformDefaultSettings'

interface MemoryStorage extends Storage {
  values: Map<string, string>
}

function createMemoryStorage(): MemoryStorage {
  const storage = {
    values: new Map<string, string>(),
    get length() {
      return this.values.size
    },
    clear() {
      this.values.clear()
    },
    getItem(key: string) {
      return this.values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(this.values.keys())[index] ?? null
    },
    removeItem(key: string) {
      this.values.delete(key)
    },
    setItem(key: string, value: string) {
      this.values.set(key, value)
    },
  }

  return storage
}

export function getReadableSettingsStorage(): Storage {
  if (typeof window === 'undefined') {
    return createMemoryStorage()
  }

  try {
    return window.localStorage
  } catch {
    return createMemoryStorage()
  }
}

export function createInitialSettingsTmp(): SettingsConsumerValue {
  const storage = getReadableSettingsStorage()
  const repository = new SettingsStorageRepository(
    storage,
    new DefaultSettingsFactory(),
    createDefaultSettingsInputFromNavigator(
      typeof window === 'undefined' ? undefined : window.navigator,
    ),
  )

  return repository.load().value
}

export function persistSettingsTmp(
  tmp: SettingsConsumerValue,
  options: { discardStored?: boolean } = {},
): SettingsSaveResult {
  let storage: Storage

  if (typeof window === 'undefined') {
    storage = createMemoryStorage()
  } else {
    try {
      storage = window.localStorage
    } catch {
      return { ok: false }
    }
  }

  const repository = new SettingsStorageRepository(
    storage,
    new DefaultSettingsFactory(),
    createDefaultSettingsInputFromNavigator(
      typeof window === 'undefined' ? undefined : window.navigator,
    ),
  )

  return { ok: repository.save(tmp, options) }
}

export function getNavigationRegenerationTarget(): EventTarget {
  return typeof window === 'undefined' ? new EventTarget() : window
}
