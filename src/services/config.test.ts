import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalData, DEFAULT_MODEL, getConfig, saveConfig } from './config';

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
