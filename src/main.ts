import './style.css'

import { bootstrapApp } from './app/main'
import { probeBootCapabilities, reportBootFailure } from './app/metrics'

bootstrapApp().catch((error: unknown) => {
  console.error('Failed to bootstrap app', error)

  // Report before touching the DOM: this is the only signal that separates a
  // visitor who saw a black screen from one who never came (docs/metrics.md).
  // Wrapped because a reporting bug must never replace the failure screen.
  try {
    reportBootFailure({
      error,
      store: (() => {
        try {
          return window.localStorage
        } catch {
          return null
        }
      })(),
      search: window.location.search,
      build: typeof __SPINWARD_BUILD__ === 'string' ? __SPINWARD_BUILD__ : 'dev',
      language: navigator.language ?? '',
      touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
      referrer: document.referrer,
      ownHost: window.location.hostname,
      probe: probeBootCapabilities(),
      send: (url, body) => {
        try {
          return navigator.sendBeacon(url, body)
        } catch {
          return false
        }
      }
    })
  } catch (reportError) {
    console.error('Failed to report boot failure', reportError)
  }

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
