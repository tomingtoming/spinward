import { isWatchActionDisabled, type WatchRenderSnapshot } from './watchBindings'
import type { WatchActionId, WatchExpandedLayout, WatchButton } from './watchLayout'
import { formatWatchParameterValue } from './watchSchema'

const clearCanvas = (ctx: CanvasRenderingContext2D) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

const drawPanelBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) => {
  ctx.fillStyle = 'rgba(4, 12, 20, 0.96)'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(100, 180, 230, 0.22)'
  ctx.lineWidth = 2
  ctx.strokeRect(4, 4, width - 8, height - 8)
}

const drawSectionDivider = (
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number
) => {
  ctx.strokeStyle = 'rgba(100, 180, 230, 0.14)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(32, y)
  ctx.lineTo(width - 32, y)
  ctx.stroke()
}

const drawSectionHeader = (
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number
) => {
  ctx.fillStyle = 'rgba(103, 232, 249, 0.8)'
  ctx.font = '700 16px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x, y)
}

const drawButton = (
  ctx: CanvasRenderingContext2D,
  button: WatchButton,
  hoveredAction: WatchActionId | null,
  state: {
    disabled?: boolean
    active?: boolean
  } = {}
) => {
  const hovered = !state.disabled && hoveredAction === button.id
  const fillStyle = state.disabled
    ? 'rgba(24, 38, 48, 0.5)'
    : hovered
      ? '#67e8f9'
      : state.active
        ? 'rgba(15, 92, 115, 0.85)'
        : 'rgba(24, 54, 72, 0.75)'
  const strokeStyle = state.disabled
    ? 'rgba(148, 163, 184, 0.15)'
    : hovered
      ? '#d9fbff'
      : state.active
        ? 'rgba(155, 231, 245, 0.7)'
        : 'rgba(192, 228, 248, 0.18)'
  const textStyle = state.disabled
    ? 'rgba(148, 163, 184, 0.5)'
    : hovered
      ? '#02131b'
      : state.active
        ? '#cdf3fa'
        : '#d0e4ee'

  const r = 4
  ctx.beginPath()
  ctx.roundRect(button.x, button.y, button.width, button.height, r)
  ctx.fillStyle = fillStyle
  ctx.fill()
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.fillStyle = textStyle
  ctx.font = '600 30px "Avenir Next", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    button.label,
    button.x + button.width * 0.5,
    button.y + button.height * 0.52
  )
}

const isActivePresetAction = (snapshot: WatchRenderSnapshot, action: WatchActionId) =>
  (action === 'preset-apply-playground' && snapshot.currentPresetId === 'playground') ||
  (action === 'preset-apply-izma' && snapshot.currentPresetId === 'izma') ||
  (action === 'preset-apply-cooper' && snapshot.currentPresetId === 'cooper') ||
  (action === 'preset-apply-elysium' && snapshot.currentPresetId === 'elysium')

const isActiveFarFieldAction = (snapshot: WatchRenderSnapshot, action: WatchActionId) =>
  (action === 'far-field-enable' && snapshot.farFieldEnabled) ||
  (action === 'far-field-disable' && !snapshot.farFieldEnabled) ||
  (action === 'far-field-mode-auto' && snapshot.farFieldMode === 'auto') ||
  (action === 'far-field-mode-day' && snapshot.farFieldMode === 'day') ||
  (action === 'far-field-mode-night' && snapshot.farFieldMode === 'night')

const isActiveProfileAction = (snapshot: WatchRenderSnapshot, action: WatchActionId) =>
  (action === 'profile-beginner' && snapshot.locomotionProfileId === 'beginner') ||
  (action === 'profile-sim' && snapshot.locomotionProfileId === 'sim') ||
  (action === 'profile-expert' && snapshot.locomotionProfileId === 'expert')

export const renderWatchExpanded = (
  ctx: CanvasRenderingContext2D,
  layout: WatchExpandedLayout,
  snapshot: WatchRenderSnapshot,
  hoveredAction: WatchActionId | null
) => {
  clearCanvas(ctx)
  drawPanelBackground(ctx, layout.width, layout.height)

  // ── Header: status badges ──
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  // Mode / region badge
  const modeLabel = snapshot.playerMode === 'attached' ? 'ATTACHED' : 'FREE-FLY'
  const modeColor = snapshot.playerMode === 'attached' ? '#34d399' : '#a78bfa'
  ctx.fillStyle = modeColor
  ctx.font = '700 22px "Avenir Next", sans-serif'
  ctx.fillText(modeLabel, 28, 18)

  const modeWidth = ctx.measureText(modeLabel).width
  ctx.fillStyle = 'rgba(216, 235, 244, 0.55)'
  ctx.font = '500 18px "Avenir Next", sans-serif'
  ctx.fillText(`${snapshot.region}`, 28 + modeWidth + 14, 21)

  // Preset + habitat line
  ctx.fillStyle = '#e8f4fa'
  ctx.font = '600 20px "Avenir Next", sans-serif'
  ctx.fillText(snapshot.currentPresetName, 28, 50)

  const presetWidth = ctx.measureText(snapshot.currentPresetName).width
  ctx.fillStyle = 'rgba(180, 210, 228, 0.65)'
  ctx.font = '500 17px "Avenir Next", sans-serif'
  ctx.fillText(
    `${snapshot.habitatType} | R ${snapshot.radius.toFixed(0)}m | g ${snapshot.surfaceGravity.toFixed(2)}`,
    28 + presetWidth + 14,
    53
  )

  // Key numbers line
  ctx.fillStyle = 'rgba(160, 195, 215, 0.6)'
  ctx.font = '400 16px "Avenir Next", sans-serif'
  ctx.fillText(
    `rpm ${snapshot.rpm.toFixed(2)} | \u03C9 ${snapshot.omega.toFixed(3)} | sim ${snapshot.simScale.toFixed(3)} | balls ${snapshot.ballCount}`,
    28,
    80
  )

  // Night mode compact
  ctx.fillText(
    `night ${snapshot.farFieldEnabled ? snapshot.farFieldResolvedMode : 'off'} | jet ${snapshot.jetpackAcceleration.toFixed(1)} | profile ${snapshot.locomotionProfileId}`,
    28,
    102
  )

  ctx.fillStyle = 'rgba(160, 195, 215, 0.72)'
  ctx.font = '400 13px "Avenir Next", sans-serif'
  ctx.fillText(
    `abs v x ${snapshot.absoluteVelocityX.toFixed(2)} | y ${snapshot.absoluteVelocityY.toFixed(2)} | z ${snapshot.absoluteVelocityZ.toFixed(2)} | |v| ${snapshot.absoluteSpeed.toFixed(2)}`,
    28,
    120
  )

  // ── Adjustment rows ──
  drawSectionDivider(ctx, 132, layout.width)
  drawSectionHeader(ctx, 'PARAMETERS', 28, 138)

  for (const row of layout.rows) {
    ctx.fillStyle = 'rgba(200, 220, 235, 0.6)'
    ctx.font = '500 16px "Avenir Next", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(row.label.toUpperCase(), row.valueX, row.valueY - 26)

    ctx.fillStyle = '#eef5fa'
    ctx.font = '700 28px "Avenir Next", sans-serif'
    ctx.fillText(formatWatchParameterValue(row.key, snapshot), row.valueX, row.valueY)

    for (const button of row.buttons) {
      drawButton(ctx, button, hoveredAction)
    }
  }

  // ── Locomotion profile ──
  drawSectionDivider(ctx, 710, layout.width)
  drawSectionHeader(ctx, 'LOCOMOTION', 28, 716)

  for (const button of layout.profileButtons) {
    drawButton(ctx, button, hoveredAction, {
      active: isActiveProfileAction(snapshot, button.id)
    })
  }

  // ── Night surface ──
  drawSectionDivider(ctx, 820, layout.width)
  drawSectionHeader(ctx, 'NIGHT SURFACE', 28, 826)

  ctx.fillStyle = 'rgba(160, 195, 215, 0.5)'
  ctx.font = '400 14px "Avenir Next", sans-serif'
  ctx.fillText('Emissive inner-wall texture for low-light readability.', 28, 848)

  for (const button of layout.farFieldEnabledButtons) {
    drawButton(ctx, button, hoveredAction, {
      active: isActiveFarFieldAction(snapshot, button.id)
    })
  }

  for (const button of layout.farFieldModeButtons) {
    drawButton(ctx, button, hoveredAction, {
      active: isActiveFarFieldAction(snapshot, button.id)
    })
  }

  const farFieldRow = layout.farFieldIntensityRow
  ctx.fillStyle = 'rgba(200, 220, 235, 0.6)'
  ctx.font = '500 16px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(farFieldRow.label.toUpperCase(), farFieldRow.valueX, farFieldRow.valueY - 26)
  ctx.fillStyle = '#eef5fa'
  ctx.font = '700 28px "Avenir Next", sans-serif'
  ctx.fillText(
    formatWatchParameterValue(farFieldRow.key, snapshot),
    farFieldRow.valueX,
    farFieldRow.valueY
  )

  for (const button of farFieldRow.buttons) {
    drawButton(ctx, button, hoveredAction)
  }

  // ── Presets ──
  drawSectionDivider(ctx, 1218, layout.width)
  drawSectionHeader(ctx, 'PRESETS', 28, 1224)

  ctx.fillStyle = 'rgba(160, 195, 215, 0.5)'
  ctx.font = '400 14px "Avenir Next", sans-serif'
  ctx.fillText('Clears balls, rebuilds physics, respawns on the inner wall.', 28, 1246)

  for (const button of layout.presetButtons) {
    drawButton(ctx, button, hoveredAction, {
      active: isActivePresetAction(snapshot, button.id)
    })
  }

  // ── Travel ──
  drawSectionDivider(ctx, 1510, layout.width)
  drawSectionHeader(ctx, 'TRAVEL', 28, 1516)

  ctx.fillStyle = 'rgba(160, 195, 215, 0.5)'
  ctx.font = '400 14px "Avenir Next", sans-serif'
  ctx.fillText(
    snapshot.habitatType === 'ring'
      ? 'Surface = street level. Overlook = above the plaza. Axis = zero-g ring center.'
      : 'Surface = street level. Overlook = above the plaza. Axis = zero-g near the end.',
    28,
    1538
  )

  for (const button of layout.respawnButtons) {
    drawButton(ctx, button, hoveredAction, {
      disabled: isWatchActionDisabled(snapshot, button.id)
    })
  }
}
