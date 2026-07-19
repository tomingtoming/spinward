import { isWatchActionDisabled, type WatchRenderSnapshot } from './watchBindings'
import type {
  WatchActionId,
  WatchButton,
  WatchScreenLayout,
  WatchSection
} from './watchLayout'
import { SECTION_PADDING } from './watchLayout'
import { formatWatchParameterValue } from './watchSchema'
import { getControlScheme, type ControlSection } from '../../xr/controlScheme'

const ACCENT = '#67e8f9'
const TEXT_BRIGHT = '#eef7fc'
const TEXT_DIM = 'rgba(190, 215, 230, 0.62)'
const TEXT_FAINT = 'rgba(160, 195, 215, 0.45)'
const EARTH_GRAVITY = 9.80665

const clearCanvas = (ctx: CanvasRenderingContext2D) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

const drawPanelBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, 'rgba(8, 20, 32, 0.97)')
  gradient.addColorStop(0.5, 'rgba(5, 13, 22, 0.96)')
  gradient.addColorStop(1, 'rgba(8, 18, 30, 0.97)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.roundRect(2, 2, width - 4, height - 4, 26)
  ctx.fill()

  ctx.strokeStyle = 'rgba(103, 232, 249, 0.30)'
  ctx.lineWidth = 2
  ctx.stroke()
}

const drawSectionCard = (
  ctx: CanvasRenderingContext2D,
  width: number,
  section: WatchSection,
  subtitle?: string
) => {
  ctx.fillStyle = 'rgba(16, 36, 52, 0.42)'
  ctx.beginPath()
  ctx.roundRect(
    SECTION_PADDING.left,
    section.top,
    width - SECTION_PADDING.left - SECTION_PADDING.right,
    section.height,
    16
  )
  ctx.fill()
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.10)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = ACCENT
  ctx.font = '700 17px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(section.title, SECTION_PADDING.left + 20, section.top + 16)

  if (subtitle !== undefined) {
    ctx.fillStyle = TEXT_FAINT
    ctx.font = '400 14px "Avenir Next", sans-serif'
    ctx.fillText(subtitle, SECTION_PADDING.left + 20, section.top + 42)
  }
}

type ButtonStyle = {
  disabled?: boolean
  active?: boolean
  accent?: boolean
}

const drawButton = (
  ctx: CanvasRenderingContext2D,
  button: WatchButton,
  hoveredAction: WatchActionId | null,
  style: ButtonStyle = {}
) => {
  const hovered = !style.disabled && hoveredAction === button.id

  let fill: string
  let stroke: string
  let text: string

  if (style.disabled) {
    fill = 'rgba(22, 34, 44, 0.45)'
    stroke = 'rgba(148, 163, 184, 0.12)'
    text = 'rgba(148, 163, 184, 0.42)'
  } else if (hovered) {
    fill = ACCENT
    stroke = '#d9fbff'
    text = '#02131b'
  } else if (style.active) {
    fill = 'rgba(20, 96, 118, 0.9)'
    stroke = 'rgba(103, 232, 249, 0.85)'
    text = '#d9fbff'
  } else if (style.accent) {
    fill = 'rgba(22, 66, 84, 0.85)'
    stroke = 'rgba(103, 232, 249, 0.55)'
    text = '#d9f6fd'
  } else {
    fill = 'rgba(22, 48, 64, 0.72)'
    stroke = 'rgba(192, 228, 248, 0.20)'
    text = '#d0e4ee'
  }

  ctx.beginPath()
  ctx.roundRect(button.x, button.y, button.width, button.height, 12)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = hovered || style.active ? 2 : 1.5
  ctx.stroke()

  ctx.fillStyle = text
  ctx.font = `600 ${button.height >= 66 ? 30 : 26}px "Avenir Next", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(button.label, button.x + button.width * 0.5, button.y + button.height * 0.54)
}

const drawStepperRow = (
  ctx: CanvasRenderingContext2D,
  row: { label: string; valueX: number; valueY: number; buttons: WatchButton[] },
  value: string,
  hoveredAction: WatchActionId | null
) => {
  ctx.fillStyle = TEXT_DIM
  ctx.font = '600 15px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(row.label.toUpperCase(), row.valueX, row.valueY - 28)

  ctx.fillStyle = TEXT_BRIGHT
  ctx.font = '700 30px "Avenir Next", sans-serif'
  ctx.fillText(value, row.valueX, row.valueY + 6)

  for (const button of row.buttons) {
    drawButton(ctx, button, hoveredAction)
  }
}

const isActivePresetAction = (snapshot: WatchRenderSnapshot, action: WatchActionId) =>
  (action === 'preset-apply-playground' && snapshot.currentPresetId === 'playground') ||
  (action === 'preset-apply-izma' && snapshot.currentPresetId === 'izma') ||
  (action === 'preset-apply-cooper' && snapshot.currentPresetId === 'cooper') ||
  (action === 'preset-apply-elysium' && snapshot.currentPresetId === 'elysium')

const drawHomeHeader = (
  ctx: CanvasRenderingContext2D,
  layout: WatchScreenLayout,
  snapshot: WatchRenderSnapshot
) => {
  const left = SECTION_PADDING.left + 20

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = ACCENT
  ctx.font = '700 16px "Avenir Next", sans-serif'
  ctx.fillText('S P I N W A R D', left, 26)

  ctx.fillStyle = TEXT_BRIGHT
  ctx.font = '700 34px "Avenir Next", sans-serif'
  ctx.fillText(snapshot.currentPresetName, left, 52)

  const modeLabel = snapshot.playerMode === 'grounded' ? 'ATTACHED' : 'FREE-FLY'
  const modeColor = snapshot.playerMode === 'grounded' ? '#34d399' : '#c4b5fd'
  ctx.font = '700 19px "Avenir Next", sans-serif'
  const modeWidth = ctx.measureText(modeLabel).width
  const badgeX = layout.width - SECTION_PADDING.right - modeWidth - 36
  ctx.fillStyle = 'rgba(16, 36, 52, 0.7)'
  ctx.beginPath()
  ctx.roundRect(badgeX, 50, modeWidth + 36, 38, 19)
  ctx.fill()
  ctx.fillStyle = modeColor
  ctx.fillText(modeLabel, badgeX + 18, 59)

  ctx.fillStyle = TEXT_DIM
  ctx.font = '500 18px "Avenir Next", sans-serif'
  ctx.fillText(
    `R ${snapshot.radius.toFixed(0)} m · wall ${snapshot.wallSpeed.toFixed(0)} m/s · balls ${snapshot.ballCount}`,
    left,
    102
  )
  ctx.fillStyle = TEXT_FAINT
  ctx.font = '400 15px "Avenir Next", sans-serif'
  ctx.fillText(
    (snapshot.feltSpeed >= 0 ? `car ${(snapshot.feltSpeed * 3.6).toFixed(0)} km/h · ` : '') +
      `|v| ${snapshot.absoluteSpeed.toFixed(0)} m/s · nom g ${snapshot.surfaceGravity.toFixed(1)} · ${snapshot.region}`,
    left,
    130
  )

  // Live perf line opposite the habitat stats: windowed fps and the active
  // depth-buffer mode, so an on-device A/B never has to leave the headset.
  // Full counters live on the TWEAKS RENDER card.
  ctx.textAlign = 'right'
  ctx.fillStyle = TEXT_DIM
  ctx.font = '600 18px "Avenir Next", sans-serif'
  ctx.fillText(
    `${Math.round(snapshot.fps)} fps · ${snapshot.depthMode.toUpperCase()}`,
    layout.width - SECTION_PADDING.right - 18,
    102
  )
  ctx.textAlign = 'left'
}

const drawSubHeader = (
  ctx: CanvasRenderingContext2D,
  layout: WatchScreenLayout,
  snapshot: WatchRenderSnapshot,
  hoveredAction: WatchActionId | null
) => {
  if (layout.backButton !== undefined) {
    drawButton(ctx, layout.backButton, hoveredAction)
  }

  ctx.fillStyle = TEXT_BRIGHT
  ctx.font = '700 30px "Avenir Next", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(layout.title ?? '', layout.width * 0.5, 52)

  ctx.fillStyle = TEXT_DIM
  ctx.font = '500 17px "Avenir Next", sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(snapshot.currentPresetName, layout.width - SECTION_PADDING.right - 18, 53)
}

const drawGravityGauge = (
  ctx: CanvasRenderingContext2D,
  layout: WatchScreenLayout,
  snapshot: WatchRenderSnapshot
) => {
  if (layout.gravityGaugeY === undefined) {
    return
  }

  const gaugeX = SECTION_PADDING.left + 20
  const gaugeWidth = layout.width - gaugeX - SECTION_PADDING.right - 20
  const gaugeY = layout.gravityGaugeY
  const ratio = snapshot.feltGravity / EARTH_GRAVITY
  const fillRatio = Math.min(ratio / 1.25, 1)

  ctx.fillStyle = TEXT_DIM
  ctx.font = '600 15px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('FELT GRAVITY', gaugeX, gaugeY - 24)
  ctx.fillStyle = TEXT_BRIGHT
  ctx.font = '700 26px "Avenir Next", sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(
    `${snapshot.feltGravity.toFixed(2)} m/s² · ${(ratio * 100).toFixed(0)}%`,
    gaugeX + gaugeWidth,
    gaugeY - 32
  )
  ctx.textAlign = 'left'

  ctx.fillStyle = 'rgba(20, 40, 56, 0.85)'
  ctx.beginPath()
  ctx.roundRect(gaugeX, gaugeY, gaugeWidth, 16, 8)
  ctx.fill()

  if (fillRatio > 0.01) {
    const fillGradient = ctx.createLinearGradient(gaugeX, 0, gaugeX + gaugeWidth, 0)
    fillGradient.addColorStop(0, 'rgba(103, 232, 249, 0.45)')
    fillGradient.addColorStop(1, ACCENT)
    ctx.fillStyle = fillGradient
    ctx.beginPath()
    ctx.roundRect(gaugeX, gaugeY, gaugeWidth * fillRatio, 16, 8)
    ctx.fill()
  }

  const markerX = gaugeX + gaugeWidth * (1 / 1.25)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(markerX, gaugeY - 5)
  ctx.lineTo(markerX, gaugeY + 21)
  ctx.stroke()
  ctx.fillStyle = TEXT_FAINT
  ctx.font = '600 13px "Avenir Next", sans-serif'
  ctx.fillText('1g', markerX + 6, gaugeY + 8)
}

const formatTriangles = (triangles: number) =>
  triangles >= 1e6
    ? `${(triangles / 1e6).toFixed(1)}M`
    : `${Math.round(triangles / 1e3)}k`

// TWEAKS RENDER card: the full perf counters (draws are what VR pays twice)
// and the depth-buffer switch for the on-device log-vs-plain A/B.
const drawRenderCard = (
  ctx: CanvasRenderingContext2D,
  layout: WatchScreenLayout,
  snapshot: WatchRenderSnapshot,
  hoveredAction: WatchActionId | null
) => {
  if (layout.renderSection === undefined || layout.depthButton === undefined) {
    return
  }

  drawSectionCard(
    ctx,
    layout.width,
    layout.renderSection,
    'LOG never z-fights but blocks early-Z · switching reloads'
  )

  const left = SECTION_PADDING.left + 20
  const top = layout.renderSection.top
  const drawReadout = (label: string, value: string, x: number) => {
    ctx.fillStyle = TEXT_DIM
    ctx.font = '600 15px "Avenir Next", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(label, x, top + 82)
    ctx.fillStyle = TEXT_BRIGHT
    ctx.font = '700 26px "Avenir Next", sans-serif'
    ctx.fillText(value, x, top + 114)
  }

  drawReadout('DEPTH', snapshot.depthMode.toUpperCase(), left)
  drawReadout('DRAWS', `${snapshot.drawCalls}`, left + 150)
  drawReadout('TRIS', formatTriangles(snapshot.triangles), left + 300)

  drawButton(ctx, layout.depthButton, hoveredAction)
}

const drawLegendGroup = (
  ctx: CanvasRenderingContext2D,
  sections: readonly ControlSection[],
  mode: 'grounded' | 'free-fly' | 'driving',
  x: number,
  top: number
) => {
  const group = sections.find((section) => section.mode === mode)
  if (group === undefined) {
    return
  }

  ctx.fillStyle = ACCENT
  ctx.font = '700 19px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(group.title, x, top)

  let y = top + 36
  for (const binding of group.bindings) {
    ctx.fillStyle = TEXT_DIM
    ctx.font = '600 18px "Avenir Next", sans-serif'
    ctx.fillText(binding.input, x, y)
    ctx.fillStyle = TEXT_BRIGHT
    ctx.font = '500 18px "Avenir Next", sans-serif'
    ctx.fillText(binding.action, x + 134, y)
    y += 40
  }
}

const drawLegend = (
  ctx: CanvasRenderingContext2D,
  layout: WatchScreenLayout,
  snapshot: WatchRenderSnapshot
) => {
  // Show the controls for the platform actually in use (PC / SP / VR).
  const { summary, sections } = getControlScheme(snapshot.platform)

  ctx.fillStyle = TEXT_DIM
  ctx.font = '500 16px "Avenir Next", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(summary, layout.width * 0.5, 90)

  // Two main modes side by side, driving across the bottom.
  drawLegendGroup(ctx, sections, 'grounded', SECTION_PADDING.left + 20, 130)
  drawLegendGroup(ctx, sections, 'free-fly', layout.width * 0.5 + 16, 130)
  drawLegendGroup(ctx, sections, 'driving', SECTION_PADDING.left + 20, 462)
}

export const renderWatch = (
  ctx: CanvasRenderingContext2D,
  layout: WatchScreenLayout,
  snapshot: WatchRenderSnapshot,
  hoveredAction: WatchActionId | null
) => {
  clearCanvas(ctx)
  drawPanelBackground(ctx, layout.width, layout.height)

  if (layout.screen === 'home') {
    drawHomeHeader(ctx, layout, snapshot)

    if (layout.travelSection !== undefined && layout.travelButtons !== undefined) {
      drawSectionCard(
        ctx,
        layout.width,
        layout.travelSection,
        'Surface = street · Overlook = above the plaza · Axis = zero-g'
      )
      for (const button of layout.travelButtons) {
        drawButton(ctx, button, hoveredAction, {
          accent: true,
          disabled: isWatchActionDisabled(snapshot, button.id)
        })
      }
    }

    if (layout.spinSection !== undefined && layout.spinRow !== undefined) {
      drawSectionCard(ctx, layout.width, layout.spinSection, 'g = ω² R — slow the spin, lighten the world')
      drawStepperRow(ctx, layout.spinRow, `${formatWatchParameterValue('rpm', snapshot)} rpm`, hoveredAction)
      drawGravityGauge(ctx, layout, snapshot)
    }

    for (const button of layout.categoryButtons ?? []) {
      drawButton(ctx, button, hoveredAction, {
        accent: true,
        // The Rain toggle latches: show its on-state like an active preset.
        active: button.id === 'weather-rain-toggle' && snapshot.raining
      })
    }

    return
  }

  drawSubHeader(ctx, layout, snapshot, hoveredAction)

  if (layout.screen === 'legend') {
    drawLegend(ctx, layout, snapshot)
    return
  }

  if (layout.screen === 'habitat') {
    if (layout.presetSection !== undefined && layout.presetButtons !== undefined) {
      drawSectionCard(ctx, layout.width, layout.presetSection, 'Rebuilds the habitat and respawns on the surface')
      for (const button of layout.presetButtons) {
        drawButton(ctx, button, hoveredAction, { active: isActivePresetAction(snapshot, button.id) })
      }
    }
  }

  if (layout.rowsSection !== undefined && layout.rows !== undefined) {
    drawSectionCard(ctx, layout.width, layout.rowsSection)
    for (const row of layout.rows) {
      drawStepperRow(ctx, row, formatWatchParameterValue(row.key, snapshot), hoveredAction)
    }
  }

  if (layout.renderSection !== undefined && layout.depthButton !== undefined) {
    drawRenderCard(ctx, layout, snapshot, hoveredAction)
  }
}
