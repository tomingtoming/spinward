import './style.css'

import { bootstrapApp } from './app/main'

bootstrapApp().catch((error: unknown) => {
  console.error('Failed to bootstrap app', error)

  // Without this the splash spinner runs forever with no hint that boot died.
  // The realistic failures are the Rapier WASM download and WebGL renderer
  // creation, both of which reject/throw before the splash is removed.
  const splash = document.getElementById('splash')

  if (splash === null) {
    return
  }

  splash.querySelector('.splash__spinner')?.remove()
  const status = splash.querySelector('p')

  if (status !== null) {
    status.textContent = 'THE HABITAT FAILED TO SPIN UP'
  }

  const detail = document.createElement('p')
  detail.className = 'splash__error-detail'
  detail.textContent =
    'This browser could not start the simulation — WebGL or WebAssembly may be unavailable. Reloading sometimes helps; otherwise try another browser.'

  const reload = document.createElement('button')
  reload.className = 'splash__reload'
  reload.textContent = 'RELOAD'
  reload.addEventListener('click', () => window.location.reload())

  splash.append(detail, reload)
})
