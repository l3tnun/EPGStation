import Box from '@mui/material/Box'

export const MDI_CALENDAR = '\u{F00ED}'
export const MDI_DELETE = '\u{F01B4}'
export const MDI_DOTS_VERTICAL = '\u{F01D9}'
export const MDI_FILMSTRIP_BOX_MULTIPLE = '\u{F0D18}'
export const MDI_LOCK_OPEN = '\u{F033F}'
export const MDI_PENCIL = '\u{F03EB}'
export const MDI_TIMER_OUTLINE = '\u{F051B}'
export const MDI_UPDATE = '\u{F06B0}'

export function LegacyMdiIcon({ code, className }: { code: string; className?: string }) {
  return (
    <Box
      aria-hidden="true"
      className={className}
      component="span"
      sx={{
        display: 'inline-block',
        font: "normal normal normal 24px/1 'Material Design Icons'",
        height: 24,
        MozOsxFontSmoothing: 'grayscale',
        textRendering: 'auto',
        WebkitFontSmoothing: 'antialiased',
        width: 24,
        '&::before': {
          content: `"${code}"`,
        },
      }}
    />
  )
}
