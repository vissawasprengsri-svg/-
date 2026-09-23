/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for a split deployment — see api/client.ts's API_BASE comment. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
