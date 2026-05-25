/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_ANALYSIS_MODEL?: string;
  readonly VITE_GEMINI_CHAT_MODEL?: string;
  readonly VITE_GEMINI_ANALYSIS_FALLBACK_MODELS?: string;
  readonly VITE_C2PA_ENABLED?: string;
}

declare module '@contentauth/c2pa-web/resources/c2pa.wasm?url' {
  const src: string;
  export default src;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
