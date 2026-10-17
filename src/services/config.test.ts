import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalData, DEFAULT_MODEL, getConfig, hasValidKeyChars, normalizeApiKey, saveConfig } from './config';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

let local: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
});

describe('config storage', () => {
  it('defaults to remembering the key', () => {
    expect(getConfig()).toEqual({ apiKey: '', modelName: DEFAULT_MODEL, rememberKey: true });
  });

  it('replaces a saved model that is no longer offered with the default', () => {
    local.setItem('locus_config', JSON.stringify({ apiKey: 'k', modelName: 'gemini-2.5-flash', rememberKey: true }));
    expect(getConfig().modelName).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('gemini-3.6-flash');
  });

  it('reads configs saved before the rememberKey option as remembered', () => {
    local.setItem('locus_config', JSON.stringify({ apiKey: 'old-key', modelName: DEFAULT_MODEL }));
    expect(getConfig()).toMatchObject({ apiKey: 'old-key', rememberKey: true });
  });

  it('keeps a remembered key in localStorage only', () => {
    expect(saveConfig({ apiKey: 'k1', modelName: DEFAULT_MODEL, rememberKey: true })).toBe(true);
    expect(JSON.parse(local.getItem('locus_config')!).apiKey).toBe('k1');
    expect(session.getItem('locus_session_key')).toBeNull();
    expect(getConfig().apiKey).toBe('k1');
  });

  it('keeps a non-remembered key out of localStorage', () => {
    saveConfig({ apiKey: 'k1', modelName: DEFAULT_MODEL, rememberKey: true });
    saveConfig({ apiKey: 'k2', modelName: DEFAULT_MODEL, rememberKey: false });
    expect(local.getItem('locus_config')).not.toContain('k1');
    expect(local.getItem('locus_config')).not.toContain('k2');
    expect(session.getItem('locus_session_key')).toBe('k2');
    expect(getConfig()).toMatchObject({ apiKey: 'k2', rememberKey: false });
  });

  it('loses a non-remembered key when the session ends', () => {
    saveConfig({ apiKey: 'k2', modelName: DEFAULT_MODEL, rememberKey: false });
    session.clear();
    expect(getConfig()).toMatchObject({ apiKey: '', rememberKey: false });
  });

  it('clears the key from both storages', () => {
    saveConfig({ apiKey: 'k2', modelName: DEFAULT_MODEL, rememberKey: false });
    clearLocalData();
    expect(local.getItem('locus_config')).toBeNull();
    expect(session.getItem('locus_session_key')).toBeNull();
  });
});

describe('API key cleanup', () => {
  it('removes whitespace and invisible characters picked up when copying', () => {
    expect(normalizeApiKey(' AIza\u200bSy-key_1\uFEFF\n')).toBe('AIzaSy-key_1');
    expect(normalizeApiKey('AIza\u00a0Sy\u2060X\u00adY')).toBe('AIzaSyXY');
  });

  it('accepts any visible ASCII key and rejects other characters', () => {
    expect(hasValidKeyChars('AIzaSyA-b_C9')).toBe(true);
    expect(hasValidKeyChars('AQ.Ab8RN6Kx-y_z.9')).toBe(true);
    expect(hasValidKeyChars('AIzaКИР')).toBe(false);
    expect(hasValidKeyChars('AIza\u00e9key')).toBe(false);
  });

  it('cleans a key already stored with invisible characters', () => {
    local.setItem('locus_config', JSON.stringify({ apiKey: 'AIza\u200bSyOld', modelName: DEFAULT_MODEL }));
    expect(getConfig().apiKey).toBe('AIzaSyOld');
  });
});
