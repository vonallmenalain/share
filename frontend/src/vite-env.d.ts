/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Kennung des Builds (siehe vite.config.ts, /version.json). */
declare const __APP_VERSION__: string;
