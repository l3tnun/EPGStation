import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Select, { type SelectChangeEvent } from '@mui/material/Select'
import { APP_SELECT_ITEM_HEIGHT, appSelectMenuProps } from '@/shared/appSelectConfig'
import type { SearchChannelOption } from '../api'
import styles from '../SearchRulePage.module.css'

export function ChannelMultiSelect({
  channelIds,
  options,
  onChange,
}: {
  channelIds: readonly number[]
  options: readonly SearchChannelOption[]
  onChange: (channelIds: number[]) => void
}) {
  const selectedValues = channelIds.map((channelId) => String(channelId))
  const channelNameById = new Map(options.map((option) => [String(option.id), option.name]))
  const hasValue = selectedValues.length > 0

  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value
    const nextValues = Array.isArray(value) ? value : value.split(',').filter(Boolean)
    onChange(nextValues.map((nextValue) => Number(nextValue)).filter(Number.isFinite))
  }

  return (
    <div
      data-channel-select-wrapper
      data-has-value={hasValue ? 'true' : 'false'}
      style={{
        display: 'block',
        maxWidth: '100%',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <Select
        multiple
        fullWidth
        displayEmpty
        variant="standard"
        className={styles.channelSelect}
        value={selectedValues}
        inputProps={{ 'aria-label': 'channelId' }}
        MenuProps={appSelectMenuProps}
        SelectDisplayProps={{
          'aria-label': 'channelId',
          className: styles.channelSelectDisplay,
        }}
        renderValue={(selected) => {
          if (selected.length === 0) {
            return <span className={styles.channelSelectPlaceholder}>channel</span>
          }

          return (
            <span className={styles.channelSelectValue}>
              {selected
                .map((selectedId) => channelNameById.get(selectedId) ?? selectedId)
                .join(', ')}
            </span>
          )
        }}
        sx={{
          minWidth: 0,
          maxWidth: '100%',
          width: '100%',
          height: APP_SELECT_ITEM_HEIGHT,
          '& .MuiInputBase-root': {
            minHeight: APP_SELECT_ITEM_HEIGHT,
            maxWidth: '100%',
            minWidth: 0,
            width: '100%',
          },
          '& .MuiSelect-select': {
            alignItems: 'center',
            boxSizing: 'border-box',
            display: 'flex',
            height: `${APP_SELECT_ITEM_HEIGHT}px !important`,
            lineHeight: `${APP_SELECT_ITEM_HEIGHT}px`,
            maxWidth: '100%',
            minHeight: `${APP_SELECT_ITEM_HEIGHT}px !important`,
            minWidth: 0,
            overflow: 'hidden',
            paddingBottom: '0 !important',
            paddingRight: hasValue ? '40px !important' : undefined,
            paddingTop: '0 !important',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
          ...(hasValue
            ? {
                '& .MuiSelect-icon': { display: 'none' },
              }
            : {}),
        }}
        onChange={handleChange}
      >
        {options.map((channel) => {
          const value = String(channel.id)
          const checked = selectedValues.includes(value)

          return (
            <MenuItem
              key={value}
              value={value}
              sx={{
                height: APP_SELECT_ITEM_HEIGHT,
                lineHeight: `${APP_SELECT_ITEM_HEIGHT}px`,
                minHeight: APP_SELECT_ITEM_HEIGHT,
              }}
            >
              <Checkbox checked={checked} size="small" />
              <span>{channel.name}</span>
            </MenuItem>
          )
        })}
      </Select>
      {hasValue ? (
        <IconButton
          aria-label="channelIdをクリア"
          sx={{
            color: '#1976d2',
            height: 32,
            minHeight: 32,
            minWidth: 32,
            padding: 0,
            position: 'absolute',
            right: 0,
            top: '50%',
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
            onChange([])
          }}
        >
          <span aria-hidden="true">×</span>
        </IconButton>
      ) : null}
    </div>
  )
}
