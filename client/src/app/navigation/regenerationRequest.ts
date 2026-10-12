export const NAVIGATION_REGENERATION_EVENT = 'epgstation:navigation-regeneration-request'

export type NavigationRegenerationEvent = CustomEvent<void>

export type NavigationRegenerationHandler = (event: NavigationRegenerationEvent) => void

export function createNavigationRegenerationEvent(): NavigationRegenerationEvent {
  return new CustomEvent<void>(NAVIGATION_REGENERATION_EVENT)
}

export function requestNavigationRegeneration(target: EventTarget): void {
  target.dispatchEvent(createNavigationRegenerationEvent())
}

export function subscribeToNavigationRegenerationRequests(
  target: EventTarget,
  handler: NavigationRegenerationHandler,
): () => void {
  const listener: EventListener = (event) => {
    handler(event as NavigationRegenerationEvent)
  }

  target.addEventListener(NAVIGATION_REGENERATION_EVENT, listener)

  return () => {
    target.removeEventListener(NAVIGATION_REGENERATION_EVENT, listener)
  }
}
