import { isWatchActionDisabled, type WatchRenderSnapshot } from './watchBindings'
import type { WatchActionId, WatchExpandedLayout, WatchButton } from './watchLayout'

const clearCanvas = (ctx: CanvasRenderingContext2D) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

const drawPanelShell = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  accentColor: string
) => {
  ctx.fillStyle = 'rgba(5, 16, 24, 0.94)'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(128, 205, 255, 0.38)'
  ctx.lineWidth = 4
  ctx.strokeRect(6, 6, width - 12, height - 12)

  ctx.fillStyle = accentColor
  ctx.fillRect(0, 0, width, 10)
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
    ? 'rgba(24, 38, 48, 0.7)'
    : hovered
      ? '#67e8f9'
      : state.active
        ? '#0f5c73'
        : '#183648'
  const strokeStyle = state.disabled
    ? 'rgba(148, 163, 184, 0.2)'
    : hovered
      ? '#d9fbff'
      : state.active
        ? '#9be7f5'
        : 'rgba(192, 228, 248, 0.24)'
  const textStyle = state.disabled ? 'rgba(148, 163, 184, 0.7)' : hovered ? '#02131b' : '#d8ebf4'

  ctx.fillStyle = fillStyle
  ctx.fillRect(button.x, button.y, button.width, button.height)
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = 2
  ctx.strokeRect(button.x, button.y, button.width, button.height)
  ctx.fillStyle = textStyle
  ctx.font = '600 32px "Avenir Next", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    button.label,
    button.x + button.width * 0.5,
    button.y + button.height * 0.53
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

export const renderWatchStatus = (
  ctx: CanvasRenderingContext2D,
  snapshot: WatchRenderSnapshot
) => {
  clearCanvas(ctx)
  drawPanelShell(ctx, ctx.canvas.width, ctx.canvas.height, snapshot.watchMenuOpen ? '#67e8f9' : '#f59e0b')

  ctx.fillStyle = '#f6fbff'
  ctx.font = '700 28px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('WATCH', 22, 18)

  ctx.fillStyle = 'rgba(216, 235, 244, 0.8)'
  ctx.font = '600 18px "Avenir Next", sans-serif'
  ctx.fillText(`${snapshot.playerMode} | ${snapshot.region}`, 22, 62)
  ctx.fillText(`${snapshot.currentPresetName} | ${snapshot.habitatType}`, 22, 88)
  ctx.fillText(
    `rpm ${snapshot.rpm.toFixed(2)} | g ${snapshot.surfaceGravity.toFixed(2)} | balls ${snapshot.ballCount}`,
    22,
    114
  )
  ctx.fillText(
    `R ${snapshot.radius.toFixed(0)}m | jet ${snapshot.jetpackAcceleration.toFixed(1)} | night ${snapshot.farFieldResolvedMode}`,
    22,
    140
  )
}

export const renderWatchExpanded = (
  ctx: CanvasRenderingContext2D,
  layout: WatchExpandedLayout,
  snapshot: WatchRenderSnapshot,
  hoveredAction: WatchActionId | null
) => {
  clearCanvas(ctx)
  drawPanelShell(ctx, layout.width, layout.height, '#67e8f9')

  ctx.fillStyle = '#f6fbff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = '700 30px "Avenir Next", sans-serif'
  ctx.fillText('LEFT WRIST / PLAY', 28, 22)

  ctx.fillStyle = 'rgba(216, 235, 244, 0.8)'
  ctx.font = '600 18px "Avenir Next", sans-serif'
  ctx.fillText(
    `${snapshot.playerMode} | ${snapshot.region} | view ${snapshot.observerMode} | trail ${snapshot.trailMode}`,
    28,
    64
  )
  ctx.fillText(
    `preset ${snapshot.currentPresetName} | ${snapshot.habitatType} | R ${snapshot.radius.toFixed(0)}m | span ${snapshot.span.toFixed(0)}m | sim ${snapshot.simScale.toFixed(3)}`,
    28,
    92
  )
  ctx.fillText(
    `g ${snapshot.surfaceGravity.toFixed(2)} | omega ${snapshot.omega.toFixed(3)} | wall ${snapshot.wallSpeed.toFixed(2)} | jet ${snapshot.jetpackAcceleration.toFixed(1)}`,
    28,
    120
  )
  ctx.fillText(
    `night ${snapshot.farFieldEnabled ? 'on' : 'off'} | mode ${snapshot.farFieldMode} -> ${snapshot.farFieldResolvedMode}`,
    28,
    148
  )
  ctx.fillText('Right trigger clicks the hovered button on the wrist.', 28, 176)

  const valuesByRowKey: Record<string, string> = {
    rpm: snapshot.rpm.toFixed(2),
    radius: `${snapshot.radius.toFixed(0)} m`,
    throwScale: snapshot.throwScale.toFixed(2),
    jetpackAcceleration: `${snapshot.jetpackAcceleration.toFixed(1)} m/s²`,
    landingAssist: snapshot.landingAssist.toFixed(1),
    reattachThreshold: snapshot.reattachThreshold.toFixed(2)
  }
  const stepLabelsByRowKey: Record<string, string> = {
    rpm: `fine ${snapshot.rpmFineStep.toFixed(2)} / coarse ${snapshot.rpmCoarseStep.toFixed(2)}`,
    radius: `fine ${snapshot.radiusFineStep.toFixed(0)} / coarse ${snapshot.radiusCoarseStep.toFixed(0)}`,
    throwScale: `fine ${snapshot.throwScaleFineStep.toFixed(2)} / coarse ${snapshot.throwScaleCoarseStep.toFixed(2)}`,
    jetpackAcceleration:
      `fine ${snapshot.jetpackAccelerationFineStep.toFixed(1)} / coarse ${snapshot.jetpackAccelerationCoarseStep.toFixed(1)}`,
    landingAssist: `fine ${snapshot.landingAssistFineStep.toFixed(1)} / coarse ${snapshot.landingAssistCoarseStep.toFixed(1)}`,
    reattachThreshold: `fine ${snapshot.reattachThresholdFineStep.toFixed(2)} / coarse ${snapshot.reattachThresholdCoarseStep.toFixed(2)}`
  }

  for (const row of layout.rows) {
    ctx.fillStyle = 'rgba(216, 235, 244, 0.74)'
    ctx.font = '600 18px "Avenir Next", sans-serif'
    ctx.fillText(row.label.toUpperCase(), row.valueX, row.valueY - 28)
    ctx.fillStyle = 'rgba(146, 190, 214, 0.82)'
    ctx.font = '500 15px "Avenir Next", sans-serif'
    ctx.fillText(stepLabelsByRowKey[row.key], row.valueX, row.valueY + 38)

    ctx.fillStyle = '#f6fbff'
    ctx.font = '700 30px "Avenir Next", sans-serif'
    ctx.fillText(valuesByRowKey[row.key], row.valueX, row.valueY)

    for (const button of row.buttons) {
      drawButton(ctx, button, hoveredAction)
    }
  }

  ctx.fillStyle = 'rgba(216, 235, 244, 0.74)'
  ctx.font = '600 18px "Avenir Next", sans-serif'
  ctx.fillText('NIGHT SURFACE', 42, 652)
  ctx.fillStyle = 'rgba(146, 190, 214, 0.82)'
  ctx.font = '500 15px "Avenir Next", sans-serif'
  ctx.fillText(
    'Inner-wall emissive texture. Keeps near-ground readability while the opposite wall glows at night.',
    42,
    678
  )

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
  ctx.fillStyle = 'rgba(216, 235, 244, 0.74)'
  ctx.font = '600 18px "Avenir Next", sans-serif'
  ctx.fillText(farFieldRow.label.toUpperCase(), farFieldRow.valueX, farFieldRow.valueY - 28)
  ctx.fillStyle = 'rgba(146, 190, 214, 0.82)'
  ctx.font = '500 15px "Avenir Next", sans-serif'
  ctx.fillText(
    `fine ${snapshot.farFieldIntensityFineStep.toFixed(2)} / coarse ${snapshot.farFieldIntensityCoarseStep.toFixed(2)}`,
    farFieldRow.valueX,
    farFieldRow.valueY + 38
  )
  ctx.fillStyle = '#f6fbff'
  ctx.font = '700 30px "Avenir Next", sans-serif'
  ctx.fillText(snapshot.farFieldIntensity.toFixed(2), farFieldRow.valueX, farFieldRow.valueY)

  for (const button of farFieldRow.buttons) {
    drawButton(ctx, button, hoveredAction)
  }

  ctx.fillStyle = 'rgba(216, 235, 244, 0.74)'
  ctx.font = '600 18px "Avenir Next", sans-serif'
  ctx.fillText('PRESETS', 42, 1124)
  ctx.fillStyle = 'rgba(146, 190, 214, 0.82)'
  ctx.font = '500 15px "Avenir Next", sans-serif'
  ctx.fillText(
    'Apply clears live balls, rebuilds Rapier scale, and respawns on the inner wall.',
    42,
    1150
  )

  for (const button of layout.presetButtons) {
    drawButton(ctx, button, hoveredAction, {
      active: isActivePresetAction(snapshot, button.id)
    })
  }

  ctx.fillStyle = 'rgba(216, 235, 244, 0.74)'
  ctx.font = '600 18px "Avenir Next", sans-serif'
  ctx.fillText('RESPAWN', 42, 1416)
  ctx.fillStyle = 'rgba(146, 190, 214, 0.82)'
  ctx.font = '500 15px "Avenir Next", sans-serif'
  ctx.fillText(
    snapshot.habitatType === 'ring'
      ? 'Inner Wall = attached. Axis End = free-fly at the ring center for a zero-g reset.'
      : 'Inner Wall = attached. Axis End = free-fly on the cylinder axis near the open end.',
    42,
    1442
  )

  for (const button of layout.respawnButtons) {
    drawButton(ctx, button, hoveredAction, {
      disabled: isWatchActionDisabled(snapshot, button.id)
    })
  }
}
