interface ImportMetaEnv {
  readonly VITE_METRO_RELEASE?: string
  readonly VITE_SHARED_ASSET_ROOT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
