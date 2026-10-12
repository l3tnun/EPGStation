export interface RgbColor {
  r: number
  g: number
  b: number
  a: number
}

function parseRgb(value: string): RgbColor | undefined {
  const commaMatch = /^rgba?\(([^)]+)\)$/.exec(value.trim())
  if (commaMatch === null) return undefined
  const normalized = commaMatch[1].replace(/\s*\/\s*/g, ', ')
  const parts = normalized.includes(',')
    ? normalized.split(',').map((part) => part.trim())
    : normalized.split(/\s+/)
  const r = Number(parts[0])
  const g = Number(parts[1])
  const b = Number(parts[2])
  const a = parts[3] === undefined ? 1 : Number(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) return undefined

  return { r, g, b, a }
}

function blendForeground(foreground: RgbColor, background: RgbColor): RgbColor {
  if (foreground.a >= 1) return foreground

  return {
    r: Math.round(foreground.r * foreground.a + background.r * (1 - foreground.a)),
    g: Math.round(foreground.g * foreground.a + background.g * (1 - foreground.a)),
    b: Math.round(foreground.b * foreground.a + background.b * (1 - foreground.a)),
    a: 1,
  }
}

function srgbToLinear(value: number): number {
  const normalized = value / 255

  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function luminance(color: RgbColor): number {
  return (
    0.2126 * srgbToLinear(color.r) + 0.7152 * srgbToLinear(color.g) + 0.0722 * srgbToLinear(color.b)
  )
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const fg = parseRgb(foreground)
  const bg = parseRgb(background)
  if (fg === undefined || bg === undefined || fg.a === 0) return undefined

  const effectiveForeground = blendForeground(fg, bg)
  const lighter = Math.max(luminance(effectiveForeground), luminance(bg))
  const darker = Math.min(luminance(effectiveForeground), luminance(bg))

  return (lighter + 0.05) / (darker + 0.05)
}

export function isBlackOnDark(foreground: string, background: string): boolean {
  const fg = parseRgb(foreground)
  const bg = parseRgb(background)
  if (fg === undefined || bg === undefined) return false

  return fg.r <= 24 && fg.g <= 24 && fg.b <= 24 && luminance(bg) <= 0.18
}
