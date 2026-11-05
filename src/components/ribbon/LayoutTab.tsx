import { Check, Proportions, RotateCwSquare, ScanText } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  MARGIN_PRESETS,
  ORIENTATIONS,
  PAPER_SIZES,
  pageGeometry,
  setPageSetup,
  usePageSetup,
  type PageSetup,
} from '../../editor/page-setup'
import { MenuItem } from '../Dropdown'
import { RibbonGroup, RibbonMenuButton } from './controls'
import type { TabProps } from './editorState'

const entries = <K extends string, V>(record: Record<K, V>) => Object.entries(record) as [K, V][]

/** The tallest paper, so the Size menu's pages are drawn to one scale. */
const LARGEST = Math.max(...Object.values(PAPER_SIZES).map((p) => p.height))

/** Inches, Word style: 1″, 0.5″. */
const inches = (px: number) => `${px / 96}″`

/**
 * Page setup for the whole document, like Word's Layout tab: margins, orientation and size, kept
 * in the shared document. Disabled for viewers and in read-only.
 */
export function LayoutTab({ session, disabled }: TabProps) {
  const setup = usePageSetup(session)
  const choose = (change: Partial<PageSetup>) => setPageSetup(session, change)
  const current = pageGeometry(setup)

  return (
    <RibbonGroup label="Page Setup" tour="page-setup">
      <div className="ribbon-row">
        <RibbonMenuButton label="Margins" icon={ScanText} disabled={disabled}>
          {(close) =>
            entries(MARGIN_PRESETS).map(([margins, preset]) => {
              const [top, right, bottom, left] = preset.margins
              return (
                <PageOption
                  key={margins}
                  checked={setup.margins === margins}
                  icon={<PageIcon width={current.pageWidth} height={current.pageHeight} margins={preset.margins} />}
                  name={preset.label}
                  detail={
                    <>
                      Top {inches(top)} · Bottom {inches(bottom)}
                      <br />
                      Left {inches(left)} · Right {inches(right)}
                    </>
                  }
                  onSelect={() => {
                    close()
                    choose({ margins })
                  }}
                />
              )
            })
          }
        </RibbonMenuButton>

        <RibbonMenuButton label="Orientation" icon={RotateCwSquare} disabled={disabled}>
          {(close) =>
            entries(ORIENTATIONS).map(([orientation, { label }]) => {
              const { pageWidth, pageHeight } = pageGeometry({ ...setup, orientation })
              return (
                <PageOption
                  key={orientation}
                  checked={setup.orientation === orientation}
                  icon={<PageIcon width={pageWidth} height={pageHeight} />}
                  name={label}
                  onSelect={() => {
                    close()
                    choose({ orientation })
                  }}
                />
              )
            })
          }
        </RibbonMenuButton>

        <RibbonMenuButton label="Size" icon={Proportions} disabled={disabled}>
          {(close) =>
            entries(PAPER_SIZES).map(([size, paper]) => (
              <PageOption
                key={size}
                checked={setup.size === size}
                icon={<PageIcon width={paper.width} height={paper.height} scaleTo={LARGEST} />}
                name={paper.label}
                detail={paper.detail}
                onSelect={() => {
                  close()
                  choose({ size })
                }}
              />
            ))
          }
        </RibbonMenuButton>
      </div>
    </RibbonGroup>
  )
}

type PageOptionProps = { checked: boolean; icon: ReactNode; name: string; detail?: ReactNode; onSelect: () => void }

/** A menu choice: a check for the current one, a small page, its name and its values. */
function PageOption({ checked, icon, name, detail, onSelect }: PageOptionProps) {
  return (
    <MenuItem checked={checked} onSelect={onSelect}>
      <span className="page-option">
        <span className="page-option-check">{checked && <Check aria-hidden size={14} />}</span>
        {icon}
        <span className="page-option-text">
          <span className="page-option-name">{name}</span>
          {detail && <span className="page-option-detail">{detail}</span>}
        </span>
      </span>
    </MenuItem>
  )
}

const BOX = 32

type PageIconProps = {
  width: number
  height: number
  /** Top, right, bottom, left, in the same units: drawn as a dashed line. Otherwise 1 inch, not drawn. */
  margins?: readonly [number, number, number, number]
  /** Draw to this scale (the largest page's long side) instead of filling the box. */
  scaleTo?: number
}

/** A small page to scale, with lines of text inside its margins. */
function PageIcon({ width, height, margins, scaleTo }: PageIconProps) {
  const scale = (BOX - 4) / (scaleTo ?? Math.max(width, height))
  const w = width * scale
  const h = height * scale
  const x = (BOX - w) / 2
  const y = (BOX - h) / 2
  const [top, right, bottom, left] = (margins ?? [96, 96, 96, 96]).map((m) => m * scale)
  const inner = { x: x + left, y: y + top, w: w - left - right, h: h - top - bottom }
  const lines = Math.max(1, Math.floor(inner.h / 3))
  return (
    <svg className="page-icon" width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden>
      <rect className="page-icon-paper" x={x} y={y} width={w} height={h} rx={1.5} />
      {Array.from({ length: Math.min(lines, 6) }, (_, i) => (
        <line
          key={i}
          className="page-icon-text"
          x1={inner.x}
          x2={inner.x + inner.w * (i % 3 === 2 ? 0.6 : 1)}
          y1={inner.y + 1 + i * 3}
          y2={inner.y + 1 + i * 3}
        />
      ))}
      {margins && <rect className="page-icon-margin" x={inner.x} y={inner.y} width={inner.w} height={inner.h} />}
    </svg>
  )
}
