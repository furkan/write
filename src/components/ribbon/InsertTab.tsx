import {
  CalendarDays,
  Image,
  Info,
  Link,
  ListCollapse,
  SeparatorHorizontal,
  Sigma,
  Smile,
  SquareCode,
  Table,
  TvMinimalPlay,
} from 'lucide-react'
import { useState } from 'react'
import { insertBlockMath, insertImage, insertInlineMath, insertYoutube, setLink } from '../../editor/blocks'
import { CALLOUT_VARIANTS, variantList } from '../../editor/extensions/callout-variants'
import { mod } from '../../editor/platform'
import { MenuItem } from '../Dropdown'
import { RibbonButton, RibbonGroup, RibbonMenuButton } from './controls'
import { keepSelection, type TabProps } from './editorState'

const GRID = { rows: 6, cols: 8 }

/** Common emoji by their shortcode; `:` in the text opens the full list. */
const EMOJI = [
  ['smile', '😄'],
  ['joy', '😂'],
  ['wink', '😉'],
  ['heart_eyes', '😍'],
  ['thinking', '🤔'],
  ['sob', '😭'],
  ['+1', '👍'],
  ['clap', '👏'],
  ['pray', '🙏'],
  ['muscle', '💪'],
  ['wave', '👋'],
  ['eyes', '👀'],
  ['heart', '❤️'],
  ['fire', '🔥'],
  ['sparkles', '✨'],
  ['tada', '🎉'],
  ['rocket', '🚀'],
  ['zap', '⚡'],
  ['bulb', '💡'],
  ['star', '⭐'],
  ['white_check_mark', '✅'],
  ['x', '❌'],
  ['warning', '⚠️'],
  ['pushpin', '📌'],
] as const

export function InsertTab({ editor, s, disabled }: TabProps) {
  const chain = () => editor.chain().focus()
  return (
    <>
      <RibbonGroup label="Tables">
        <RibbonMenuButton label="Table" icon={Table} kind="disclosure" disabled={disabled}>
          {(close) => (
            <TablePicker
              onPick={(rows, cols) => {
                close()
                chain().insertTable({ rows, cols, withHeaderRow: true }).run()
              }}
            />
          )}
        </RibbonMenuButton>
      </RibbonGroup>

      <RibbonGroup label="Media">
        <div className="ribbon-row">
          <RibbonButton size="large" label="Picture" icon={Image} disabled={disabled} onClick={() => insertImage(editor)} />
          <RibbonButton size="large" label="Video" icon={TvMinimalPlay} disabled={disabled} onClick={() => insertYoutube(editor)} />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Links">
        <RibbonButton size="large" label="Link" shortcut={`${mod}+K`} icon={Link} active={s.link} disabled={disabled} onClick={() => setLink(editor)} />
      </RibbonGroup>

      <RibbonGroup label="Symbols">
        <div className="ribbon-row">
          <RibbonMenuButton label="Equation" icon={Sigma} disabled={disabled}>
            {(close) => (
              <>
                <MenuItem
                  hint="$$x$$"
                  onSelect={() => {
                    close()
                    insertInlineMath(editor)
                  }}
                >
                  Inline equation
                </MenuItem>
                <MenuItem
                  hint="$$$x$$$"
                  onSelect={() => {
                    close()
                    insertBlockMath(editor)
                  }}
                >
                  Equation block
                </MenuItem>
              </>
            )}
          </RibbonMenuButton>
          <RibbonMenuButton label="Emoji" icon={Smile} kind="disclosure" disabled={disabled}>
            {(close) => (
              <div className="emoji-panel">
                <div className="emoji-grid">
                  {EMOJI.map(([name, char]) => (
                    <button
                      key={name}
                      type="button"
                      title={`:${name}:`}
                      aria-label={name.replace(/_/g, ' ')}
                      onMouseDown={keepSelection}
                      onClick={() => {
                        close()
                        chain().setEmoji(name).run()
                      }}
                    >
                      {char}
                    </button>
                  ))}
                </div>
                <p className="muted small">
                  Type <kbd>:</kbd> in the text for every emoji.
                </p>
              </div>
            )}
          </RibbonMenuButton>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Blocks">
        <div className="ribbon-row">
          <RibbonMenuButton label="Callout" icon={Info} disabled={disabled}>
            {(close) =>
              variantList.map((variant) => (
                <MenuItem
                  key={variant}
                  hint={`:::${variant}`}
                  onSelect={() => {
                    close()
                    chain().setCallout(variant).run()
                  }}
                >
                  <span className="menu-icon">{CALLOUT_VARIANTS[variant].icon}</span> {CALLOUT_VARIANTS[variant].label}
                </MenuItem>
              ))
            }
          </RibbonMenuButton>
          <RibbonButton size="large" label="Toggle" icon={ListCollapse} disabled={disabled} onClick={() => chain().setDetails().run()} />
          <RibbonButton
            size="large"
            label="Divider"
            icon={SeparatorHorizontal}
            disabled={disabled}
            onClick={() => chain().setHorizontalRule().run()}
          />
          <RibbonButton
            size="large"
            label="Code block"
            shortcut={`${mod}+Alt+C`}
            icon={SquareCode}
            active={s.codeBlock}
            disabled={disabled}
            onClick={() => chain().toggleCodeBlock().run()}
          />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Text">
        <RibbonButton
          size="large"
          label="Date"
          shortcut={`${mod}+Shift+D`}
          icon={CalendarDays}
          disabled={disabled}
          onClick={() => chain().insertDate().run()}
        />
      </RibbonGroup>
    </>
  )
}

/** Word's table grid: point at a size and click. */
function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [size, setSize] = useState({ rows: 3, cols: 3 })
  return (
    <div className="table-picker" onMouseLeave={() => setSize({ rows: 3, cols: 3 })}>
      <div className="table-picker-grid" style={{ gridTemplateColumns: `repeat(${GRID.cols}, 1fr)` }}>
        {Array.from({ length: GRID.rows * GRID.cols }, (_, i) => {
          const rows = Math.floor(i / GRID.cols) + 1
          const cols = (i % GRID.cols) + 1
          const on = rows <= size.rows && cols <= size.cols
          return (
            <button
              key={i}
              type="button"
              className={on ? 'on' : undefined}
              aria-label={`${cols} by ${rows} table`}
              onMouseDown={keepSelection}
              onMouseEnter={() => setSize({ rows, cols })}
              onFocus={() => setSize({ rows, cols })}
              onClick={() => onPick(rows, cols)}
            />
          )
        })}
      </div>
      <div className="table-picker-caption" aria-live="polite">
        {size.cols} × {size.rows} table
      </div>
    </div>
  )
}
