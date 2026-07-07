// Share cluster next to the beat bar: Link folds the current view into a URL
// (system share sheet on touch, clipboard elsewhere), Photo downloads the
// frame with the wordmark + site burned in. Both are flat-screen widgets; the
// whole dock already hides in VR.

export type ShareOutcome = 'shared' | 'copied' | 'failed'

export type ShareBarHandle = {
  destroy: () => void
  setVisible: (visible: boolean) => void
}

const FLASH_MILLISECONDS = 1500

export const createShareBar = (
  mount: HTMLElement,
  handlers: {
    onShareLink: () => Promise<ShareOutcome>
    onPhoto: () => Promise<boolean>
  }
): ShareBarHandle => {
  const root = document.createElement('div')
  root.className = 'beat-bar'

  const label = document.createElement('span')
  label.className = 'beat-label'
  label.textContent = 'Share'

  const makeButton = (text: string, onTap: () => void) => {
    const button = document.createElement('button')
    button.textContent = text
    button.className = 'beat-btn'
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      onTap()
    })
    return button
  }

  // Feedback happens in place: the button label flashes the outcome, so there
  // is no toast layer to build or dismiss.
  const flash = (button: HTMLButtonElement, idle: string, text: string) => {
    button.textContent = text
    button.disabled = true
    window.setTimeout(() => {
      button.textContent = idle
      button.disabled = false
    }, FLASH_MILLISECONDS)
  }

  const link = makeButton('Link', () => {
    void handlers.onShareLink().then((outcome) => {
      if (outcome === 'copied') {
        flash(link, 'Link', 'Copied!')
      } else if (outcome === 'failed') {
        flash(link, 'Link', 'Failed')
      }
      // 'shared' → the system sheet gave its own feedback.
    })
  })

  const photo = makeButton('Photo', () => {
    // 'Saved!' only after the encoder actually produced the download.
    void handlers.onPhoto().then((saved) => {
      flash(photo, 'Photo', saved ? 'Saved!' : 'Failed')
    })
  })

  root.append(label, link, photo)
  mount.append(root)

  return {
    destroy: () => root.remove(),
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    }
  }
}
