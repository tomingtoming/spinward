import type { WatchRenderSnapshot } from './watchBindings'
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
  hoveredAction: WatchActionId | null
) => {
  const hovered = hoveredAction === button.id

  ctx.fillStyle = hovered ? '#67e8f9' : '#183648'
  ctx.fillRect(button.x, button.y, button.width, button.height)
  ctx.strokeStyle = hovered ? '#d9fbff' : 'rgba(192, 228, 248, 0.24)'
  ctx.lineWidth = 2
  ctx.strokeRect(button.x, button.y, button.width, button.height)
  ctx.fillStyle = hovered ? '#02131b' : '#d8ebf4'
  ctx.font = '600 32px "Avenir Next", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    button.label,
    button.x + button.width * 0.5,
    button.y + button.height * 0.53
  )
}

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
  ctx.font = '600 20px "Avenir Next", sans-serif'
  ctx.fillText(`${snapshot.playerMode} | ${snapshot.region}`, 22, 62)
  ctx.fillText(`rpm ${snapshot.rpm.toFixed(1)} | g ${snapshot.surfaceGravity.toFixed(1)}`, 22, 92)
  ctx.fillText(`R ${snapshot.radius.toFixed(0)}m | balls ${snapshot.ballCount}`, 22, 122)
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
    `g ${snapshot.surfaceGravity.toFixed(2)} | omega ${snapshot.omega.toFixed(3)} | wall ${snapshot.wallSpeed.toFixed(2)} | balls ${snapshot.ballCount}`,
    28,
    92
  )
  ctx.fillText('Right trigger clicks the hovered button on the wrist.', 28, 120)

  const valuesByRowKey: Record<string, string> = {
    rpm: snapshot.rpm.toFixed(2),
    radius: `${snapshot.radius.toFixed(0)} m`,
    throwScale: snapshot.throwScale.toFixed(2),
    landingAssist: snapshot.landingAssist.toFixed(1),
    reattachThreshold: snapshot.reattachThreshold.toFixed(2)
  }
  const stepLabelsByRowKey: Record<string, string> = {
    rpm: `fine ${snapshot.rpmFineStep.toFixed(2)} / coarse ${snapshot.rpmCoarseStep.toFixed(2)}`,
    radius: `fine ${snapshot.radiusFineStep.toFixed(0)} / coarse ${snapshot.radiusCoarseStep.toFixed(0)}`,
    throwScale: `fine ${snapshot.throwScaleFineStep.toFixed(2)} / coarse ${snapshot.throwScaleCoarseStep.toFixed(2)}`,
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
}
