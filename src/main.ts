import './style.css'

import { bootstrapApp } from './app/main'
import {
  bootFailureIssueUrl,
  classifyBootFailure,
  probeBootCapabilities,
  reportBootFailure
} from './app/metrics'

bootstrapApp().catch((error: unknown) => {
  console.error('Failed to bootstrap app', error)

  const probe = probeBootCapabilities()
  const build = typeof __SPINWARD_BUILD__ === 'string' ? __SPINWARD_BUILD__ : 'dev'

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
      build,
      language: navigator.language ?? '',
      touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
      referrer: document.referrer,
      ownHost: window.location.hostname,
      probe,
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

  // The one visitor who can say what broke on an engine nobody here can run
  // (Firefox, Safari, an integrated GPU) is looking at this screen. Prefill
  // the bug template with what the page already knows so they only type
  // what they saw. Plain link: it must work with the app entirely dead.
  const report = document.createElement('a')
  report.className = 'splash__report'
  report.href = bootFailureIssueUrl({
    reason: classifyBootFailure(error, probe),
    build,
    userAgent: navigator.userAgent,
    probe,
    error
  })
  report.target = '_blank'
  report.rel = 'noopener'
  report.textContent = 'REPORT ON GITHUB'

  splash.append(detail, reload, report)
})
