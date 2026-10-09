export interface ModelOption {
  id: string;
  label: string;
  preview?: boolean;
}

/** Models offered in Settings. All support Grounding with Google Maps and Google Search (checked 2026-10-08). */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (recommended)' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (legacy)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview, slower, may be withdrawn)', preview: true },
];

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export interface LocusConfig {
  apiKey: string;
  modelName: string;
  /** true: key kept in localStorage across sessions; false: only in this tab's sessionStorage. */
  rememberKey: boolean;
}

export const DEFAULT_CONFIG: LocusConfig = { apiKey: '', modelName: DEFAULT_MODEL, rememberKey: true };

const CONFIG_KEY = 'locus_config';
const SESSION_KEY = 'locus_session_key';
export const HISTORY_KEY = 'osint_history';

export function isKnownModel(id: string): boolean {
  return MODEL_OPTIONS.some((m) => m.id === id);
}

function readSessionKey(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function getConfig(): LocusConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocusConfig>;
      const rememberKey = parsed.rememberKey !== false;
      return {
        apiKey: rememberKey ? (typeof parsed.apiKey === 'string' ? parsed.apiKey : '') : readSessionKey(),
        modelName:
          typeof parsed.modelName === 'string' && isKnownModel(parsed.modelName)
            ? parsed.modelName
            : DEFAULT_MODEL,
        rememberKey,
      };
    }
  } catch (e) {
    console.error('Could not read settings from localStorage', e);
  }
  return { ...DEFAULT_CONFIG, apiKey: readSessionKey() };
}

export function saveConfig(config: LocusConfig): boolean {
  try {
    if (config.rememberKey) {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      const { apiKey, ...rest } = config;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(rest));
      sessionStorage.setItem(SESSION_KEY, apiKey);
    }
    return true;
  } catch (e) {
    console.error('Could not save settings to browser storage', e);
    return false;
  }
}

export function clearLocalData(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(HISTORY_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.error('Could not clear browser storage', e);
  }
}
