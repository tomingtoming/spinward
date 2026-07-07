// Photo mode: composite the live WebGL canvas with a wordmark + URL footer
// and hand it to the browser as a download. The drawing buffer is not
// preserved across frames (preserveDrawingBuffer is off for performance), so
// the caller re-renders synchronously via `renderFrame` and the pixels are
// read in the same task, while they are still this frame's.

export const capturePhoto = (
  source: HTMLCanvasElement,
  renderFrame: () => void,
  { url, filename }: { url: string; filename: string }
): boolean => {
  renderFrame()

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')

  if (ctx === null) {
    return false
  }

  ctx.drawImage(source, 0, 0)

  // Footer: a soft scrim so the wordmark/URL read on any scene, day or night.
  const pad = Math.max(14, Math.round(canvas.width * 0.02))
  const scrimHeight = Math.max(64, Math.round(canvas.height * 0.14))
  const scrim = ctx.createLinearGradient(0, canvas.height - scrimHeight, 0, canvas.height)
  scrim.addColorStop(0, 'rgba(2, 8, 14, 0)')
  scrim.addColorStop(1, 'rgba(2, 8, 14, 0.66)')
  ctx.fillStyle = scrim
  ctx.fillRect(0, canvas.height - scrimHeight, canvas.width, scrimHeight)

  const fontPx = Math.max(15, Math.round(canvas.width * 0.016))
  const baseline = canvas.height - pad

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(223, 243, 251, 0.95)'
  ctx.font = `700 ${fontPx}px system-ui, sans-serif`
  ctx.textAlign = 'left'
  // Tracked-out wordmark; letterSpacing is skipped where unsupported.
  const spacedCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if (typeof spacedCtx.letterSpacing === 'string') {
    spacedCtx.letterSpacing = '0.18em'
  }
  ctx.fillText('SPINWARD', pad, baseline)
  if (typeof spacedCtx.letterSpacing === 'string') {
    spacedCtx.letterSpacing = '0em'
  }

  ctx.fillStyle = 'rgba(159, 214, 239, 0.9)'
  ctx.font = `500 ${fontPx}px system-ui, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText(url, canvas.width - pad, baseline)

  canvas.toBlob((blob) => {
    if (blob === null) {
      return
    }

    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    // Revoking synchronously races the download's read of the blob
    // (net::ERR_FAILED); give the browser a moment to take it.
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10000)
  }, 'image/png')

  return true
}
