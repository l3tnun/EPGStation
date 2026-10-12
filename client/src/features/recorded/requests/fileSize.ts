const RECORDED_FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function formatRecordedFileSize(size: number | undefined): string {
  let normalizedSize = typeof size === 'number' && Number.isFinite(size) ? size : 0
  let unitIndex = 0

  for (; unitIndex < RECORDED_FILE_SIZE_UNITS.length - 1; unitIndex += 1) {
    if (normalizedSize < 1000) {
      break
    }
    normalizedSize /= 1024
  }

  return `${normalizedSize.toFixed(1)}${RECORDED_FILE_SIZE_UNITS[unitIndex]}`
}
