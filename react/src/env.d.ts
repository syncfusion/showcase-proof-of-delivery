/// <reference types="vite/client" />
declare const __APP_NAME__: string;
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /** Syncfusion license key, registered at startup (see .env.example). */
  readonly VITE_SYNCFUSION_LICENSE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}