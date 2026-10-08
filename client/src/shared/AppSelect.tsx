import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import {
  APP_SELECT_ITEM_HEIGHT,
  appSelectMenuProps,
  createAppSelectMenuProps,
} from './appSelectConfig'

export interface AppSelectOption {
  value: string | number
  label: ReactNode
  disabled?: boolean
  hidden?: boolean
}

interface AppSelectBaseProps {
  ariaLabel: string
  className?: string
  disabled?: boolean
  label?: string
  options: readonly AppSelectOption[]
  variant?: 'standard' | 'outlined' | 'filled'
  wrapperClassName?: string
  inputProps?: Record<string, string>
  displayProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>
  renderValue?: (selected: unknown) => ReactNode
  clearable?: boolean
  controlHeight?: number
  disableMenuInternalScroll?: boolean
  menuMaxVisibleItems?: number
  onClear?: () => void
  showEmptyOptionLabel?: boolean
}

export type AppSelectProps = AppSelectBaseProps & {
  value: string | number
  onChange: (value: string) => void
}

export function AppSelect(props: AppSelectProps) {
  const {
    ariaLabel,
    className,
    disabled = false,
    displayProps,
    disableMenuInternalScroll = false,
    inputProps,
    label,
    menuMaxVisibleItems,
    onClear,
    options,
    renderValue,
    showEmptyOptionLabel = false,
    clearable = false,
    controlHeight = 48,
    value,
    variant = 'standard',
    wrapperClassName,
  } = props
  const inputDataProps = Object.fromEntries(
    Object.entries(inputProps ?? {}).filter(([key]) => key.startsWith('data-')),
  )
  const selectDisplayProps = {
    'aria-label': ariaLabel,
    'aria-labelledby': undefined,
    ...inputDataProps,
    ...displayProps,
  }
  const selectInputProps = inputProps === undefined ? undefined : { ...inputProps }
  if (selectInputProps !== undefined) {
    delete selectInputProps['aria-label']
  }
  const selectedValues = [String(value)]
  const hasCurrentOption = selectedValues.every((selectedValue) =>
    options.some((option) => String(option.value) === selectedValue),
  )
  const renderOptions =
    selectedValues.some((selectedValue) => selectedValue !== '') && !hasCurrentOption
      ? [
          ...selectedValues
            .filter((selectedValue) => selectedValue !== '')
            .filter(
              (selectedValue) => !options.some((option) => String(option.value) === selectedValue),
            )
            .map((selectedValue) => ({
              value: selectedValue,
              label: selectedValue,
              hidden: true,
            })),
          ...options,
        ]
      : options

  const hasValue = String(value) !== ''
  const emptyOptionLabel = options.find((option) => String(option.value) === '')?.label
  const defaultRenderValue = (selected: unknown) => {
    const selectedList = Array.isArray(selected)
      ? selected.map((item) => String(item))
      : [String(selected)]
    if (selectedList.length === 0 || selectedList.every((selectedValue) => selectedValue === '')) {
      // defaultRenderValue only ever becomes the active renderValue when showEmptyOptionLabel is
      // true (see effectiveRenderValue below), so that flag is always true here.
      return emptyOptionLabel ?? ''
    }

    return selectedList
      .map(
        (selectedValue) =>
          options.find((option) => String(option.value) === selectedValue)?.label ?? selectedValue,
      )
      .join(', ')
  }
  const showClearButton = clearable && !disabled && hasValue && onClear !== undefined
  const effectiveRenderValue =
    renderValue ?? (showEmptyOptionLabel ? defaultRenderValue : undefined)
  const menuItemStyle: CSSProperties = {
    height: APP_SELECT_ITEM_HEIGHT,
    lineHeight: `${APP_SELECT_ITEM_HEIGHT}px`,
    minHeight: APP_SELECT_ITEM_HEIGHT,
  }
  const menuProps =
    menuMaxVisibleItems === undefined && !disableMenuInternalScroll
      ? appSelectMenuProps
      : createAppSelectMenuProps(menuMaxVisibleItems, {
          disableInternalScroll: disableMenuInternalScroll,
        })

  return (
    <div
      className={wrapperClassName}
      data-app-select-wrapper
      style={{
        display: 'block',
        position: 'relative',
        width: wrapperClassName === undefined ? '100%' : undefined,
      }}
    >
      <TextField
        fullWidth
        select
        className={className}
        disabled={disabled}
        label={label}
        variant={variant}
        value={value}
        sx={{
          '& .MuiInputBase-root': {
            minHeight: controlHeight,
          },
          '& .MuiSelect-select': {
            alignItems: 'center',
            boxSizing: 'border-box',
            display: 'flex',
            height: `${controlHeight}px !important`,
            minHeight: `${controlHeight}px !important`,
            paddingBottom: '0 !important',
            paddingTop: '0 !important',
          },
          ...(showClearButton
            ? {
                '& .MuiSelect-icon': {
                  display: 'none',
                },
                '& .MuiSelect-select': {
                  alignItems: 'center',
                  boxSizing: 'border-box',
                  display: 'flex',
                  height: `${controlHeight}px !important`,
                  minHeight: `${controlHeight}px !important`,
                  paddingBottom: '0 !important',
                  paddingRight: '40px !important',
                  paddingTop: '0 !important',
                },
              }
            : {}),
        }}
        slotProps={{
          select: {
            displayEmpty: showEmptyOptionLabel,
            MenuProps: menuProps,
            SelectDisplayProps: selectDisplayProps,
            inputProps: selectInputProps,
            renderValue: effectiveRenderValue,
          },
        }}
        onChange={(event) => {
          const nextValue = event.target.value
          props.onChange(String(nextValue))
        }}
      >
        {renderOptions.map((option) => {
          const isHidden = 'hidden' in option && option.hidden

          return (
            <MenuItem
              key={String(option.value)}
              disabled={'disabled' in option ? option.disabled : undefined}
              style={isHidden ? undefined : menuItemStyle}
              value={option.value}
              sx={
                isHidden
                  ? { display: 'none' }
                  : {
                      height: APP_SELECT_ITEM_HEIGHT,
                      lineHeight: `${APP_SELECT_ITEM_HEIGHT}px`,
                      minHeight: APP_SELECT_ITEM_HEIGHT,
                    }
              }
            >
              {option.label}
            </MenuItem>
          )
        })}
      </TextField>
      {showClearButton ? (
        <IconButton
          aria-label={`${ariaLabel}をクリア`}
          sx={{
            color: '#1976d2',
            height: 32,
            minHeight: 32,
            minWidth: '32px',
            padding: 0,
            position: 'absolute',
            right: 0,
            top: controlHeight / 2,
            transform: 'translateY(-50%)',
            width: 32,
            zIndex: 1,
            '& span': {
              color: 'inherit',
              fontSize: 28,
              lineHeight: 1,
            },
          }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClear()
          }}
        >
          <span aria-hidden="true">×</span>
        </IconButton>
      ) : null}
    </div>
  )
}
