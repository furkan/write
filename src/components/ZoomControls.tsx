import { Minus, Plus } from 'lucide-react'
import { usePagedView } from '../editor/page-setup'
import { setZoom, setZoomFit, stepZoom, useZoomSetting, ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS, ZOOM_STEP } from '../editor/zoom'
import { Dropdown, MenuItem } from './Dropdown'

/** The presets, then Page width and One page: the View tab's Zoom menu and the status bar's. */
export function ZoomMenuItems({ zoom, onDone }: { zoom: number; onDone: () => void }) {
  const { fit } = useZoomSetting()
  // Only Print layout shows a page to fit.
  const canFit = usePagedView()
  const fitting = canFit ? fit : null
  const pick = (run: () => void) => () => {
    run()
    onDone()
  }
  return (
    <>
      {ZOOM_PRESETS.map((percent) => (
        <MenuItem key={percent} checked={!fitting && zoom === percent} onSelect={pick(() => setZoom(percent))}>
          {!fitting && zoom === percent && <span aria-hidden>✓ </span>}
          {percent}%
        </MenuItem>
      ))}
      <hr />
      <MenuItem checked={fitting === 'page-width'} disabled={!canFit} onSelect={pick(() => setZoomFit('page-width'))}>
        {fitting === 'page-width' && <span aria-hidden>✓ </span>}Page width
      </MenuItem>
      <MenuItem checked={fitting === 'one-page'} disabled={!canFit} onSelect={pick(() => setZoomFit('one-page'))}>
        {fitting === 'one-page' && <span aria-hidden>✓ </span>}One page
      </MenuItem>
    </>
  )
}

const STEP_KEYS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowUp: 1, PageUp: 1, ArrowLeft: -1, ArrowDown: -1, PageDown: -1 }

/**
 * Word's status-bar zoom: out, a slider, in, and the percentage (which opens the presets). The
 * slider is a range input, so the arrow keys, Page Up/Down, Home and End work on it.
 */
export function ZoomSlider({ zoom }: { zoom: number }) {
  return (
    <span className="status-item zoom-control" role="group" aria-label="Zoom" data-tour="zoom-slider">
      <button
        type="button"
        className="status-toggle"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => stepZoom(zoom, -1)}
      >
        <Minus aria-hidden size={14} />
      </button>
      <input
        type="range"
        className="zoom-range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={zoom}
        aria-label="Zoom"
        aria-valuetext={`${zoom}%`}
        title={`Zoom: ${zoom}%`}
        onChange={(e) => setZoom(Number(e.target.value))}
        onKeyDown={(e) => {
          // The same steps as the buttons: the range would step from its own rounded value
          // (85% from a fit shows as 90%, so → would give 100%).
          const direction = STEP_KEYS[e.key]
          if (!direction) return
          e.preventDefault()
          stepZoom(zoom, direction)
        }}
      />
      <button
        type="button"
        className="status-toggle"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => stepZoom(zoom, 1)}
      >
        <Plus aria-hidden size={14} />
      </button>
      <Dropdown label={`${zoom}%`} title={`Zoom: ${zoom}%. Choose a zoom`} className="zoom-percent" align="end" fixed>
        {(close) => <ZoomMenuItems zoom={zoom} onDone={close} />}
      </Dropdown>
    </span>
  )
}
