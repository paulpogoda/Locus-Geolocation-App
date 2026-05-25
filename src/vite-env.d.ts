/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_ANALYSIS_MODEL?: string;
  readonly VITE_GEMINI_CHAT_MODEL?: string;
  readonly VITE_GEMINI_ANALYSIS_FALLBACK_MODELS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
