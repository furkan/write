import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Columns3,
  PanelTop,
  Rows3,
  SquareCode,
  TableCellsMerge,
  TableCellsSplit,
  Trash,
} from 'lucide-react'
import { lowlight } from '../../editor/extensions'
import { mod } from '../../editor/platform'
import { RibbonButton, RibbonGroup } from './controls'
import type { TabProps } from './editorState'

const LANGUAGES = lowlight
  .listLanguages()
  .filter((lang) => lang !== 'plaintext')
  .sort()

/** Shown while the cursor is in a table. */
export function TableTab({ editor, s, disabled }: TabProps) {
  const chain = () => editor.chain().focus()
  return (
    <>
      <RibbonGroup label="Rows">
        <div className="ribbon-stack">
          <RibbonButton size="medium" label="Insert above" icon={BetweenHorizontalStart} disabled={disabled} onClick={() => chain().addRowBefore().run()} />
          <RibbonButton size="medium" label="Insert below" icon={BetweenHorizontalEnd} disabled={disabled} onClick={() => chain().addRowAfter().run()} />
          <RibbonButton size="medium" label="Delete row" icon={Rows3} disabled={disabled} onClick={() => chain().deleteRow().run()} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Columns">
        <div className="ribbon-stack">
          <RibbonButton size="medium" label="Insert left" icon={BetweenVerticalStart} disabled={disabled} onClick={() => chain().addColumnBefore().run()} />
          <RibbonButton size="medium" label="Insert right" icon={BetweenVerticalEnd} disabled={disabled} onClick={() => chain().addColumnAfter().run()} />
          <RibbonButton size="medium" label="Delete column" icon={Columns3} disabled={disabled} onClick={() => chain().deleteColumn().run()} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Merge">
        <div className="ribbon-row">
          <RibbonButton
            size="large"
            label="Merge cells"
            icon={TableCellsMerge}
            disabled={disabled || !s.canMerge}
            onClick={() => chain().mergeCells().run()}
          />
          <RibbonButton
            size="large"
            label="Split cell"
            icon={TableCellsSplit}
            disabled={disabled || !s.canSplit}
            onClick={() => chain().splitCell().run()}
          />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Table">
        <div className="ribbon-row">
          <RibbonButton size="large" label="Header row" icon={PanelTop} disabled={disabled} onClick={() => chain().toggleHeaderRow().run()} />
          <RibbonButton size="large" label="Delete table" icon={Trash} disabled={disabled} onClick={() => chain().deleteTable().run()} />
        </div>
      </RibbonGroup>
    </>
  )
}

/** Shown while the cursor is in a code block. */
export function CodeTab({ editor, s, disabled }: TabProps) {
  return (
    <>
      <RibbonGroup label="Language">
        <label className="ribbon-field">
          <span>Language</span>
          <select
            aria-label="Code language"
            disabled={disabled}
            value={s.codeLanguage}
            onChange={(e) => editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value }).run()}
          >
            <option value="plaintext">Plain text</option>
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
      </RibbonGroup>
      <RibbonGroup label="Code block">
        <RibbonButton
          size="large"
          label="Code block"
          shortcut={`${mod}+Alt+C`}
          icon={SquareCode}
          active={s.codeBlock}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
      </RibbonGroup>
    </>
  )
}
