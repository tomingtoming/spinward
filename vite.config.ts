import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [basicSsl()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    https: true
  }
})
