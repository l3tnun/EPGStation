import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField, { type TextFieldProps } from '@mui/material/TextField'

type ClearableTextFieldProps = Omit<TextFieldProps, 'onChange' | 'value'> & {
  clearLabel?: string
  onChange?: TextFieldProps['onChange']
  onClear: () => void
  value: string
}

export function ClearableTextField({
  clearLabel,
  disabled,
  onClear,
  slotProps,
  value,
  ...props
}: ClearableTextFieldProps) {
  const inputSlotProps =
    slotProps?.input === undefined || typeof slotProps.input === 'function' ? {} : slotProps.input

  return (
    <TextField
      {...props}
      disabled={disabled}
      value={value}
      slotProps={{
        ...slotProps,
        input: {
          ...inputSlotProps,
          endAdornment:
            value === '' || disabled ? (
              'endAdornment' in inputSlotProps ? (
                inputSlotProps.endAdornment
              ) : undefined
            ) : (
              <InputAdornment position="end" sx={{ alignSelf: 'center', height: '100%', m: 0 }}>
                <IconButton
                  aria-label={clearLabel ?? `${props.label ?? '入力'}をクリア`}
                  size="small"
                  sx={{ mr: 0 }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClear()
                  }}
                >
                  <span aria-hidden="true">×</span>
                </IconButton>
              </InputAdornment>
            ),
        },
      }}
    />
  )
}
