import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import { useEffect, useId, useState } from 'react'
import type { HTMLAttributes, MouseEvent, ReactNode } from 'react'

export function RecordedPlainDialog({
  open,
  title,
  ariaLabel,
  maxWidth = 300,
  paperAttributes,
  onClose,
  children,
}: {
  open: boolean
  title?: string
  ariaLabel?: string
  maxWidth?: 300 | 400 | 500 | 600
  paperAttributes?: HTMLAttributes<HTMLDivElement>
  onClose?: () => void
  children: ReactNode
}) {
  const titleId = useId()
  // `isMounted` is set as soon as `open` becomes true and only cleared once the Dialog's
  // transition reports `onExited`, so children stay mounted for the whole closing transition.
  // If `open` becomes true again before `onExited` fires, the transition reverses in place and
  // children are never unmounted, so their state is preserved. Children only unmount (and next
  // remount fresh) once `onExited` has actually fired while `open` is false.
  const [isMounted, setIsMounted] = useState(open)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMounted(true)
    }
  }, [open])

  if (!isMounted) {
    return null
  }

  return (
    // MUI's Dialog renders through a portal (its content is appended under `document.body`,
    // outside this component's DOM subtree), but React dispatches a portal's events along the
    // *React* component tree rather than the DOM tree (this is documented React portal
    // behavior). Clicking anywhere inside the Dialog to close it -- the "container" area outside
    // the paper (`Dialog.js` `handleBackdropClick`/`handleMouseDown`) as well as the Backdrop
    // element itself (`Modal`'s `createHandleBackdropClick`) -- never calls
    // `event.stopPropagation()` internally. Left unguarded, that click keeps bubbling past this
    // Dialog, through the React tree, to whichever list row/card rendered the menu that opened
    // it, firing that row's own `onClick` (its item-detail navigation) as a side effect of
    // merely closing this dialog. This wrapper has no visual effect (Dialog's actual content is
    // portaled elsewhere) and only stops a click that has already finished bubbling through the
    // Dialog itself from escaping further up to real page content.
    <div onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>
      <Dialog
        open={open}
        aria-label={title === undefined ? ariaLabel : undefined}
        aria-labelledby={title === undefined ? undefined : titleId}
        scroll="paper"
        onClose={onClose}
        slotProps={{
          backdrop: {
            onClick: onClose,
          },
          paper: {
            ...paperAttributes,
            'aria-label': title === undefined ? ariaLabel : undefined,
            sx: {
              width: 'calc(100% - 32px)',
              maxWidth,
            },
          },
          transition: {
            onExited: () => setIsMounted(false),
          },
        }}
      >
        {title === undefined ? undefined : <DialogTitle id={titleId}>{title}</DialogTitle>}
        {children}
      </Dialog>
    </div>
  )
}
