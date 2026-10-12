import Box from '@mui/material/Box'

export const MDI_CLOCK_OUTLINE = '\\F0150'
export const MDI_DOTS_VERTICAL = '\\F01D9'
export const MDI_UPDATE = '\\F06B0'
export const MDI_BOOKMARK = '\\F00C0'
export const MDI_COG = '\\F0493'

export function LegacyToolbarIcon({ code }: { code: string }) {
  return (
    <Box
      aria-hidden="true"
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
