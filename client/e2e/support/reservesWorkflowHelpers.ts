export function isExpectedBrowserConsoleNoise(text: string): boolean {
  return (
    text.includes('Failed to load resource') ||
    text.includes('downloadable font: rejected by sanitizer')
  )
}
