import './style.css'

import { bootstrapApp } from './app/main'

bootstrapApp().catch((error: unknown) => {
  console.error('Failed to bootstrap app', error)
})
