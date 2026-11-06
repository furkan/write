import type { Editor } from '@tiptap/react'
import {
  AArrowDown,
  AArrowUp,
  Bold,
  ChevronDown,
  Code,
  EyeOff,
  Highlighter,
  Italic,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListTodo,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  TextQuote,
  Underline,
} from 'lucide-react'
import { useState } from 'react'
import { mod } from '../../editor/platform'
import { Dropdown, MenuItem } from '../Dropdown'
import { ColorSplitButton, RibbonButton, RibbonGroup } from './controls'
import { HEADING_LEVELS, keepSelection, tooltip, type TabProps } from './editorState'
import { FONT_SIZES, parseFontSize, stepFontSize } from './fontSize'
import { useMediaQuery } from './state'

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, "SF Mono", Consolas, monospace' },
  { label: 'Rounded', value: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { label: 'Handwriting', value: '"Comic Sans MS", "Comic Neue", cursive' },
]

const TEXT_COLORS = [
  { color: '#e11d48', name: 'Red' },
  { color: '#ea580c', name: 'Orange' },
  { color: '#ca8a04', name: 'Gold' },
  { color: '#16a34a', name: 'Green' },
  { color: '#0891b2', name: 'Teal' },
  { color: '#2563eb', name: 'Blue' },
  { color: '#7c3aed', name: 'Purple' },
  { color: '#c026d3', name: 'Magenta' },
  { color: '#6b7280', name: 'Grey' },
]
const HIGHLIGHTS = [
  { color: '#fef08a', name: 'Yellow' },
  { color: '#bbf7d0', name: 'Green' },
  { color: '#bae6fd', name: 'Blue' },
  { color: '#e9d5ff', name: 'Purple' },
  { color: '#fecdd3', name: 'Pink' },
  { color: '#fed7aa', name: 'Orange' },
]

const STYLES = [
  { level: 0, name: 'Normal' },
  ...HEADING_LEVELS.map((level) => ({ level, name: `Heading ${level}` })),
]

export function HomeTab({ editor, s, disabled }: TabProps) {
  const chain = () => editor.chain().focus()

  return (
    <>
      <RibbonGroup label="Font" tour="font">
        <div className="ribbon-row">
          <FontPicker editor={editor} value={s.fontFamily} disabled={disabled} />
          <FontSize editor={editor} size={s.fontSize} disabled={disabled} />
          <div className="ribbon-cluster">
            <RibbonButton
              label="Grow font"
              icon={AArrowUp}
              disabled={disabled}
              onClick={() => stepFontSize(editor, 1)}
            />
            <RibbonButton
              label="Shrink font"
              icon={AArrowDown}
              disabled={disabled}
              onClick={() => stepFontSize(editor, -1)}
            />
            <RibbonButton
              label="Clear formatting"
              icon={RemoveFormatting}
              disabled={disabled}
              onClick={() => chain().unsetAllMarks().clearNodes().run()}
            />
          </div>
        </div>
        <div className="ribbon-row">
          <div className="ribbon-cluster" data-tour="marks">
            <RibbonButton label="Bold" shortcut={`${mod}+B`} icon={Bold} active={s.bold} disabled={disabled} onClick={() => chain().toggleBold().run()} />
            <RibbonButton label="Italic" shortcut={`${mod}+I`} icon={Italic} active={s.italic} disabled={disabled} onClick={() => chain().toggleItalic().run()} />
            <RibbonButton
              label="Underline"
              shortcut={`${mod}+U`}
              icon={Underline}
              active={s.underline}
              disabled={disabled}
              onClick={() => chain().toggleUnderline().run()}
            />
            <RibbonButton
              label="Strikethrough"
              shortcut={`${mod}+Shift+S`}
              icon={Strikethrough}
              active={s.strike}
              disabled={disabled}
              onClick={() => chain().toggleStrike().run()}
            />
            <RibbonButton
              label="Subscript"
              shortcut={`${mod}+,`}
              icon={Subscript}
              active={s.subscript}
              disabled={disabled}
              onClick={() => chain().toggleSubscript().run()}
            />
            <RibbonButton
              label="Superscript"
              shortcut={`${mod}+.`}
              icon={Superscript}
              active={s.superscript}
              disabled={disabled}
              onClick={() => chain().toggleSuperscript().run()}
            />
            <RibbonButton label="Inline code" shortcut={`${mod}+E`} icon={Code} active={s.code} disabled={disabled} onClick={() => chain().toggleCode().run()} />
            <RibbonButton
              label="Spoiler"
              shortcut={`${mod}+Alt+S`}
              icon={EyeOff}
              active={s.spoiler}
              disabled={disabled}
              onClick={() => chain().toggleSpoiler().run()}
            />
          </div>
          <div className="ribbon-cluster" data-tour="colors">
            <ColorSplitButton
              label="Font colour"
              glyph={<span className="color-letter">A</span>}
              colors={TEXT_COLORS}
              kind="text"
              clearLabel="Automatic"
              disabled={disabled}
              onApply={(color) => chain().setColor(color).run()}
              onClear={() => chain().unsetColor().run()}
            />
            <ColorSplitButton
              label="Highlight"
              shortcut={`${mod}+Shift+H`}
              glyph={<Highlighter size={15} />}
              colors={HIGHLIGHTS}
              kind="highlight"
              clearLabel="No highlight"
              disabled={disabled}
              onApply={(color) => chain().setHighlight({ color }).run()}
              onClear={() => chain().unsetHighlight().run()}
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Paragraph">
        <div className="ribbon-row" data-tour="lists">
          <div className="ribbon-cluster">
            <RibbonButton
              label="Bullets"
              shortcut={`${mod}+Shift+8`}
              icon={List}
              active={s.bulletList}
              disabled={disabled}
              onClick={() => chain().toggleBulletList().run()}
            />
            <RibbonButton
              label="Numbering"
              shortcut={`${mod}+Shift+7`}
              icon={ListOrdered}
              active={s.orderedList}
              disabled={disabled}
              onClick={() => chain().toggleOrderedList().run()}
            />
            <RibbonButton
              label="Task list"
              shortcut={`${mod}+Shift+9`}
              icon={ListTodo}
              active={s.taskList}
              disabled={disabled}
              onClick={() => chain().toggleTaskList().run()}
            />
          </div>
          <div className="ribbon-cluster">
            <RibbonButton
              label="Outdent"
              shortcut="Shift+Tab"
              icon={ListIndentDecrease}
              disabled={disabled || !s.listItemType}
              onClick={() => s.listItemType && chain().liftListItem(s.listItemType).run()}
            />
            <RibbonButton
              label="Indent"
              shortcut="Tab"
              icon={ListIndentIncrease}
              disabled={disabled || !s.listItemType}
              onClick={() => s.listItemType && chain().sinkListItem(s.listItemType).run()}
            />
          </div>
        </div>
        <div className="ribbon-row">
          <div className="ribbon-cluster" data-tour="align">
            {(
              [
                ['left', 'Align left', TextAlignStart, 'L'],
                ['center', 'Center', TextAlignCenter, 'E'],
                ['right', 'Align right', TextAlignEnd, 'R'],
                ['justify', 'Justify', TextAlignJustify, 'J'],
              ] as const
            ).map(([align, label, icon, key]) => (
              <RibbonButton
                key={align}
                label={label}
                shortcut={`${mod}+Shift+${key}`}
                icon={icon}
                active={s.align === align}
                disabled={disabled}
                onClick={() => chain().setTextAlign(align).run()}
              />
            ))}
          </div>
          <div className="ribbon-cluster">
            <RibbonButton
              label="Quote"
              shortcut={`${mod}+Shift+B`}
              icon={TextQuote}
              active={s.blockquote}
              disabled={disabled}
              onClick={() => chain().toggleBlockquote().run()}
            />
            <RibbonButton
              label="Code block"
              shortcut={`${mod}+Alt+C`}
              icon={SquareCode}
              active={s.codeBlock}
              disabled={disabled}
              onClick={() => chain().toggleCodeBlock().run()}
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Styles" tour="text-style">
        <StyleGallery editor={editor} current={s.heading} disabled={disabled} />
      </RibbonGroup>
    </>
  )
}

function FontPicker({ editor, value, disabled }: { editor: Editor; value: string; disabled: boolean }) {
  const known = FONT_FAMILIES.find((f) => f.value === value)
  // A font that came in with pasted content: show its first family.
  const name = known?.label ?? value.split(',')[0].replace(/["']/g, '').trim()
  return (
    <Dropdown
      fixed
      className="ribbon-combo font-picker"
      title={`Font: ${name}`}
      disabled={disabled}
      label={
        <>
          <span className="combo-value" style={{ fontFamily: value || undefined }}>
            {name}
          </span>
          <ChevronDown aria-hidden size={12} />
        </>
      }
    >
      {(close) =>
        FONT_FAMILIES.map((font) => (
          <MenuItem
            key={font.label}
            checked={font.value === value}
            onSelect={() => {
              close()
              const chain = editor.chain().focus()
              if (font.value) chain.setFontFamily(font.value).run()
              else chain.unsetFontFamily().run()
            }}
          >
            <span className="font-sample" style={{ fontFamily: font.value || undefined }}>
              {font.label}
            </span>
          </MenuItem>
        ))
      }
    </Dropdown>
  )
}

/** Editable font size in px: type a number and press Enter, or pick a preset. Empty for mixed sizes. */
function FontSize({ editor, size, disabled }: { editor: Editor; size: number | null; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const apply = (px: number) => {
    setDraft(null)
    editor.chain().focus().setFontSize(`${px}px`).run()
  }
  return (
    <div className="ribbon-combo font-size">
      <input
        aria-label="Font size"
        title="Font size (px): type a size and press Enter"
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? (size === null ? '' : String(size))}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const px = draft === null ? null : parseFontSize(draft)
            if (px === null) setDraft(null)
            else apply(px)
          } else if (e.key === 'Escape') {
            setDraft(null)
            editor.commands.focus()
          }
        }}
      />
      <Dropdown fixed className="combo-arrow" title="Font sizes" disabled={disabled} label={<ChevronDown aria-hidden size={12} />}>
        {(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close()
                editor.chain().focus().unsetFontSize().run()
              }}
            >
              Default
            </MenuItem>
            {FONT_SIZES.map((px) => (
              <MenuItem
                key={px}
                checked={px === size}
                onSelect={() => {
                  close()
                  apply(px)
                }}
              >
                {px}
              </MenuItem>
            ))}
          </>
        )}
      </Dropdown>
    </div>
  )
}

type StyleTilesProps = { editor: Editor; current: number; disabled: boolean; count?: number; onPicked?: () => void }

function StyleTiles({ editor, current, disabled, count = STYLES.length, onPicked }: StyleTilesProps) {
  return STYLES.slice(0, count).map(({ level, name }) => (
    <button
      key={level}
      type="button"
      className={`style-tile${level === current ? ' active' : ''}`}
      title={tooltip(name, `${mod}+Alt+${level}`)}
      aria-pressed={level === current}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={() => {
        const chain = editor.chain().focus()
        if (level === 0) chain.setParagraph().run()
        else chain.setHeading({ level: level as (typeof HEADING_LEVELS)[number] }).run()
        onPicked?.()
      }}
    >
      <span className={`style-sample level-${level}`} aria-hidden>
        AaBbCc
      </span>
      <span className="style-name">{name}</span>
    </button>
  ))
}

/** A row of styles (fewer on phones), and a button that shows them all. */
function StyleGallery({ editor, current, disabled }: { editor: Editor; current: number; disabled: boolean }) {
  const narrow = useMediaQuery('(max-width: 700px)')
  return (
    <div className="style-gallery">
      <div className="style-row">
        <StyleTiles editor={editor} current={current} disabled={disabled} count={narrow ? 4 : STYLES.length} />
      </div>
      <Dropdown
        fixed
        kind="disclosure"
        align="end"
        className="style-more"
        title="All styles"
        disabled={disabled}
        label={<ChevronDown aria-hidden size={14} />}
      >
        {(close) => (
          <div className="style-grid">
            <StyleTiles editor={editor} current={current} disabled={disabled} onPicked={close} />
          </div>
        )}
      </Dropdown>
    </div>
  )
}
