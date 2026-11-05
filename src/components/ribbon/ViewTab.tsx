import {
  FileText,
  Focus,
  Globe,
  Lock,
  MoveHorizontal,
  PanelRight,
  Pilcrow,
  RectangleVertical,
  Search,
  SunMoon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { setLayoutMode, useLayoutMode, useNarrowScreen, usePagedView } from '../../editor/page-setup'
import { setZoom, setZoomFit, stepZoom, useZoomSetting, ZOOM_MAX, ZOOM_MIN } from '../../editor/zoom'
import { ThemeMenuItems } from '../ThemeToggle'
import { ZoomMenuItems } from '../ZoomControls'
import { RibbonButton, RibbonGroup, RibbonMenuButton } from './controls'
import { useDocumentChrome } from './documentContext'

const NARROW_HINT = 'Narrow screens use continuous layout'

/**
 * Word's View tab: Print or Web layout, what to show, Read-only, zoom and the theme. All of it is
 * your own view of the document, so viewers get it too (Read-only is fixed on for them).
 */
export function ViewTab() {
  const { role, view, setView, canToggleReadOnly, zoom } = useDocumentChrome()
  const mode = useLayoutMode()
  const narrow = useNarrowScreen()
  const canFit = usePagedView()
  const { fit } = useZoomSetting()

  return (
    <>
      <RibbonGroup label="Views" tour="views">
        <div className="ribbon-row">
          <RibbonButton
            size="large"
            label="Print layout"
            title={narrow ? NARROW_HINT : 'Print layout: pages'}
            icon={FileText}
            active={mode === 'print' && !narrow}
            disabled={narrow}
            onClick={() => setLayoutMode('print')}
          />
          <RibbonButton
            size="large"
            label="Web layout"
            title={narrow ? NARROW_HINT : 'Web layout: one continuous page'}
            icon={Globe}
            active={mode === 'web' && !narrow}
            disabled={narrow}
            onClick={() => setLayoutMode('web')}
          />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Show" tour="show">
        <div className="ribbon-stack">
          <RibbonButton size="medium" label="Contents" title="Contents sidebar" icon={PanelRight} active={view.sidebar} onClick={() => setView({ sidebar: !view.sidebar })} />
          <RibbonButton
            size="medium"
            label="Invisible characters"
            icon={Pilcrow}
            active={view.invisibles}
            onClick={() => setView({ invisibles: !view.invisibles })}
          />
          <RibbonButton size="medium" label="Focus mode" icon={Focus} active={view.focusMode} onClick={() => setView({ focusMode: !view.focusMode })} />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Editing">
        <RibbonButton
          size="large"
          label="Read-only"
          title={role === 'viewer' ? 'Read-only (view only)' : 'Read-only'}
          icon={Lock}
          active={view.readOnly}
          disabled={!canToggleReadOnly}
          onClick={() => setView({ readOnly: !view.readOnly })}
        />
      </RibbonGroup>

      <RibbonGroup label="Zoom" tour="zoom">
        <div className="ribbon-row">
          <RibbonMenuButton label="Zoom" icon={Search}>
            {(close) => <ZoomMenuItems zoom={zoom} onDone={close} />}
          </RibbonMenuButton>
          <RibbonButton
            size="large"
            label="100%"
            title="Zoom to 100%"
            glyph={<span className="zoom-glyph">100</span>}
            active={zoom === 100 && !(canFit && fit)}
            onClick={() => setZoom(100)}
          />
          <div className="ribbon-stack">
            <RibbonButton size="medium" label="Zoom in" icon={ZoomIn} disabled={zoom >= ZOOM_MAX} onClick={() => stepZoom(zoom, 1)} />
            <RibbonButton size="medium" label="Zoom out" icon={ZoomOut} disabled={zoom <= ZOOM_MIN} onClick={() => stepZoom(zoom, -1)} />
          </div>
          <div className="ribbon-stack">
            <RibbonButton
              size="medium"
              label="One page"
              title={canFit ? 'One page: fit a whole page on screen' : 'One page (Print layout only)'}
              icon={RectangleVertical}
              active={canFit && fit === 'one-page'}
              disabled={!canFit}
              onClick={() => setZoomFit('one-page')}
            />
            <RibbonButton
              size="medium"
              label="Page width"
              title={canFit ? 'Page width: fit the page to the window' : 'Page width (Print layout only)'}
              icon={MoveHorizontal}
              active={canFit && fit === 'page-width'}
              disabled={!canFit}
              onClick={() => setZoomFit('page-width')}
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Theme">
        <RibbonMenuButton label="Theme" icon={SunMoon}>
          {(close) => <ThemeMenuItems onDone={close} />}
        </RibbonMenuButton>
      </RibbonGroup>
    </>
  )
}
