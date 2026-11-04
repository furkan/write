import { useEditorState, type Editor } from '@tiptap/react'
import { blockActions, setLink } from '../editor/blocks'
import { lowlight } from '../editor/extensions'
import { mod } from '../editor/platform'
import { Dropdown, MenuItem } from './Dropdown'
import { ToolButton } from './ToolButton'


const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, "SF Mono", Consolas, monospace' },
  { label: 'Rounded', value: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { label: 'Handwriting', value: '"Comic Sans MS", "Comic Neue", cursive' },
]

const FONT_SIZES = ['', '12px', '14px', '16px', '20px', '24px', '32px', '40px']

const TEXT_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#6b7280']
const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#bae6fd', '#e9d5ff', '#fecdd3', '#fed7aa']

type ToolbarProps = {
  editor: Editor
  readOnly: boolean
}

export function Toolbar({ editor, readOnly }: ToolbarProps) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      subscript: e.isActive('subscript'),
      superscript: e.isActive('superscript'),
      spoiler: e.isActive('spoiler'),
      link: e.isActive('link'),
      highlight: e.isActive('highlight'),
      heading: HEADING_LEVELS.find((level) => e.isActive('heading', { level })) ?? 0,
      fontFamily: (e.getAttributes('textStyle').fontFamily as string | undefined) ?? '',
      fontSize: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '',
      color: (e.getAttributes('textStyle').color as string | undefined) ?? '',
      align: (['left', 'center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      codeLanguage: (e.getAttributes('codeBlock').language as string | undefined) ?? 'plaintext',
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      canSink: e.can().sinkListItem('listItem') || e.can().sinkListItem('taskItem'),
      canLift: e.can().liftListItem('listItem') || e.can().liftListItem('taskItem'),
    }),
  })

  const chain = () => editor.chain().focus()

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting" data-tour="toolbar" aria-disabled={readOnly}>
      <div className="toolbar-row">
        <div className="group" data-tour="history">
          <ToolButton title="Undo" shortcut={`${mod}+Z`} disabled={readOnly || !s.canUndo} onClick={() => chain().undo().run()}>
            ↶
          </ToolButton>
          <ToolButton
            title="Redo"
            shortcut={`${mod}+Shift+Z`}
            disabled={readOnly || !s.canRedo}
            onClick={() => chain().redo().run()}
          >
            ↷
          </ToolButton>
        </div>

        <div className="group" data-tour="text-style">
          <select
            aria-label="Block type"
            title="Block type"
            disabled={readOnly}
            value={s.heading}
            onChange={(e) => {
              const level = Number(e.target.value)
              if (level === 0) chain().setParagraph().run()
              else chain().setHeading({ level: level as (typeof HEADING_LEVELS)[number] }).run()
            }}
          >
            <option value={0}>Paragraph</option>
            {HEADING_LEVELS.map((level) => (
              <option key={level} value={level}>
                Heading {level}
              </option>
            ))}
          </select>
          <select
            aria-label="Font family"
            title="Font family"
            disabled={readOnly}
            value={FONT_FAMILIES.some((f) => f.value === s.fontFamily) ? s.fontFamily : ''}
            onChange={(e) =>
              e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run()
            }
          >
            {FONT_FAMILIES.map((font) => (
              <option key={font.label} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Font size"
            title="Font size"
            disabled={readOnly}
            value={FONT_SIZES.includes(s.fontSize) ? s.fontSize : ''}
            onChange={(e) => (e.target.value ? chain().setFontSize(e.target.value).run() : chain().unsetFontSize().run())}
          >
            {FONT_SIZES.map((size) => (
              <option key={size || 'default'} value={size}>
                {size ? size.replace('px', '') : 'Size'}
              </option>
            ))}
          </select>
        </div>

        <div className="group" data-tour="marks">
          <ToolButton title="Bold" shortcut={`${mod}+B`} active={s.bold} disabled={readOnly} onClick={() => chain().toggleBold().run()}>
            <b>B</b>
          </ToolButton>
          <ToolButton title="Italic" shortcut={`${mod}+I`} active={s.italic} disabled={readOnly} onClick={() => chain().toggleItalic().run()}>
            <i>I</i>
          </ToolButton>
          <ToolButton
            title="Underline"
            shortcut={`${mod}+U`}
            active={s.underline}
            disabled={readOnly}
            onClick={() => chain().toggleUnderline().run()}
          >
            <u>U</u>
          </ToolButton>
          <ToolButton
            title="Strikethrough"
            shortcut={`${mod}+Shift+S`}
            active={s.strike}
            disabled={readOnly}
            onClick={() => chain().toggleStrike().run()}
          >
            <s>S</s>
          </ToolButton>
          <ToolButton title="Inline code" shortcut={`${mod}+E`} active={s.code} disabled={readOnly} onClick={() => chain().toggleCode().run()}>
            {'</>'}
          </ToolButton>
          <ToolButton
            title="Subscript"
            shortcut={`${mod}+,`}
            active={s.subscript}
            disabled={readOnly}
            onClick={() => chain().toggleSubscript().run()}
          >
            x₂
          </ToolButton>
          <ToolButton
            title="Superscript"
            shortcut={`${mod}+.`}
            active={s.superscript}
            disabled={readOnly}
            onClick={() => chain().toggleSuperscript().run()}
          >
            x²
          </ToolButton>
          <ToolButton
            title="Spoiler (custom mark)"
            shortcut={`${mod}+Alt+S`}
            active={s.spoiler}
            disabled={readOnly}
            onClick={() => chain().toggleSpoiler().run()}
          >
            ▒
          </ToolButton>
          <ToolButton title="Link" shortcut={`${mod}+K`} active={s.link} disabled={readOnly} onClick={() => setLink(editor)}>
            🔗
          </ToolButton>
        </div>

        <div className="group" data-tour="colors">
          <Dropdown label={<span className="swatch-label" style={{ color: s.color || undefined }}>A</span>} title="Text color" disabled={readOnly}>
            {(close) => (
              <div className="swatches">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="swatch"
                    style={{ background: color }}
                    title={color}
                    aria-label={`Text color ${color}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      chain().setColor(color).run()
                      close()
                    }}
                  />
                ))}
                <button
                  type="button"
                  className="swatch swatch-clear"
                  title="Default color"
                  aria-label="Default text color"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    chain().unsetColor().run()
                    close()
                  }}
                >
                  ⨯
                </button>
              </div>
            )}
          </Dropdown>
          <Dropdown label={<span className={`swatch-label highlight${s.highlight ? ' on' : ''}`}>H</span>} title="Highlight" disabled={readOnly}>
            {(close) => (
              <div className="swatches">
                {HIGHLIGHTS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="swatch"
                    style={{ background: color }}
                    title={color}
                    aria-label={`Highlight ${color}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      chain().setHighlight({ color }).run()
                      close()
                    }}
                  />
                ))}
                <button
                  type="button"
                  className="swatch swatch-clear"
                  title="Remove highlight"
                  aria-label="Remove highlight"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    chain().unsetHighlight().run()
                    close()
                  }}
                >
                  ⨯
                </button>
              </div>
            )}
          </Dropdown>
          <ToolButton title="Clear formatting" disabled={readOnly} onClick={() => chain().unsetAllMarks().clearNodes().run()}>
            ⌫
          </ToolButton>
        </div>

        <div className="group" data-tour="align">
          {(
            [
              ['left', '⇤', `${mod}+Shift+L`],
              ['center', '↔', `${mod}+Shift+E`],
              ['right', '⇥', `${mod}+Shift+R`],
              ['justify', '☰', `${mod}+Shift+J`],
            ] as const
          ).map(([align, icon, shortcut]) => (
            <ToolButton
              key={align}
              title={`Align ${align}`}
              shortcut={shortcut}
              active={s.align === align}
              disabled={readOnly}
              onClick={() => chain().setTextAlign(align).run()}
            >
              {icon}
            </ToolButton>
          ))}
        </div>

        <div className="group" data-tour="lists">
          <ToolButton
            title="Bullet list"
            shortcut={`${mod}+Shift+8`}
            active={s.bulletList}
            disabled={readOnly}
            onClick={() => chain().toggleBulletList().run()}
          >
            •≡
          </ToolButton>
          <ToolButton
            title="Numbered list"
            shortcut={`${mod}+Shift+7`}
            active={s.orderedList}
            disabled={readOnly}
            onClick={() => chain().toggleOrderedList().run()}
          >
            1≡
          </ToolButton>
          <ToolButton
            title="Task list"
            shortcut={`${mod}+Shift+9`}
            active={s.taskList}
            disabled={readOnly}
            onClick={() => chain().toggleTaskList().run()}
          >
            ☑
          </ToolButton>
          <ToolButton
            title="Indent"
            shortcut="Tab"
            disabled={readOnly || !s.canSink}
            onClick={() => (s.taskList ? chain().sinkListItem('taskItem').run() : chain().sinkListItem('listItem').run())}
          >
            →
          </ToolButton>
          <ToolButton
            title="Outdent"
            shortcut="Shift+Tab"
            disabled={readOnly || !s.canLift}
            onClick={() => (s.taskList ? chain().liftListItem('taskItem').run() : chain().liftListItem('listItem').run())}
          >
            ←
          </ToolButton>
          <ToolButton
            title="Quote"
            shortcut={`${mod}+Shift+B`}
            active={s.blockquote}
            disabled={readOnly}
            onClick={() => chain().toggleBlockquote().run()}
          >
            ❝
          </ToolButton>
          <ToolButton
            title="Code block"
            shortcut={`${mod}+Alt+C`}
            active={s.codeBlock}
            disabled={readOnly}
            onClick={() => chain().toggleCodeBlock().run()}
          >
            {'{ }'}
          </ToolButton>
        </div>

        <div className="group" data-tour="insert">
          <Dropdown label="＋ Insert" title="Insert block" className="wide" disabled={readOnly}>
            {(close) =>
              blockActions.map((action) => (
                <MenuItem
                  key={action.id}
                  hint={action.hint}
                  onSelect={() => {
                    close()
                    action.run(editor)
                  }}
                >
                  <span className="menu-icon">{action.icon}</span> {action.label}
                </MenuItem>
              ))
            }
          </Dropdown>
        </div>
      </div>

      {!readOnly && s.codeBlock && (
        <div className="toolbar-row contextual" aria-label="Code block options">
          <span className="contextual-label">Code block</span>
          <select
            aria-label="Code language"
            value={s.codeLanguage}
            onChange={(e) => chain().updateAttributes('codeBlock', { language: e.target.value }).run()}
          >
            <option value="plaintext">Plain text</option>
            {lowlight
              .listLanguages()
              .filter((lang) => lang !== 'plaintext')
              .sort()
              .map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
          </select>
        </div>
      )}

      {!readOnly && s.table && <TableControls editor={editor} />}
    </div>
  )
}

function TableControls({ editor }: { editor: Editor }) {
  const can = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      merge: e.can().mergeCells(),
      split: e.can().splitCell(),
    }),
  })
  const chain = () => editor.chain().focus()

  return (
    <div className="toolbar-row contextual" aria-label="Table options" data-tour="table-controls">
      <span className="contextual-label">Table</span>
      <ToolButton title="Add row above" onClick={() => chain().addRowBefore().run()}>
        ↑+ Row
      </ToolButton>
      <ToolButton title="Add row below" onClick={() => chain().addRowAfter().run()}>
        ↓+ Row
      </ToolButton>
      <ToolButton title="Delete row" onClick={() => chain().deleteRow().run()}>
        − Row
      </ToolButton>
      <ToolButton title="Add column left" onClick={() => chain().addColumnBefore().run()}>
        ←+ Col
      </ToolButton>
      <ToolButton title="Add column right" onClick={() => chain().addColumnAfter().run()}>
        →+ Col
      </ToolButton>
      <ToolButton title="Delete column" onClick={() => chain().deleteColumn().run()}>
        − Col
      </ToolButton>
      <ToolButton title="Merge cells (select several cells first)" disabled={!can.merge} onClick={() => chain().mergeCells().run()}>
        Merge
      </ToolButton>
      <ToolButton title="Split cell" disabled={!can.split} onClick={() => chain().splitCell().run()}>
        Split
      </ToolButton>
      <ToolButton title="Toggle header row" onClick={() => chain().toggleHeaderRow().run()}>
        Header
      </ToolButton>
      <ToolButton title="Delete table" onClick={() => chain().deleteTable().run()}>
        🗑 Table
      </ToolButton>
    </div>
  )
}
