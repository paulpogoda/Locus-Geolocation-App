import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
const chatsCreate = vi.fn();
const ctorArgs: unknown[] = [];

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
    chats = { create: chatsCreate };
    constructor(opts: unknown) {
      ctorArgs.push(opts);
    }
  },
}));

const { DirectGeminiProvider } = await import('./directGeminiProvider');
const { LocusError } = await import('./errors');

const answer = (text: string, metadata?: unknown) => ({
  text,
  candidates: [{ finishReason: 'STOP', groundingMetadata: metadata }],
});
const good = JSON.stringify({
  locationName: 'Tallinn',
  coordinates: { lat: 59.437, lng: 24.7536 },
  confidence: 0.7,
  searchQueriesExecuted: ['claimed query'],
});
const input = { base64Data: 'AAAA', mimeType: 'image/jpeg', mode: 'visual' as const, groundingTool: 'maps' as const };
const provider = (modelName = 'gemini-3.8-flash') =>
  new DirectGeminiProvider(() => ({ apiKey: 'test-key', modelName }));

beforeEach(() => {
  generateContent.mockReset();
  chatsCreate.mockReset();
  ctorArgs.length = 0;
});

describe('DirectGeminiProvider', () => {
  it('requires a key', async () => {
    const p = new DirectGeminiProvider(() => ({ apiKey: '', modelName: 'gemini-3.8-flash' }));
    await expect(p.analyzeImage(input)).rejects.toMatchObject({ code: 'NO_KEY' });
  });

  it('creates the client with the key only (no custom headers)', async () => {
    generateContent.mockResolvedValue(answer(good));
    await provider().analyzeImage(input);
    expect(ctorArgs).toEqual([{ apiKey: 'test-key' }]);
  });

  it('does not request JSON mode together with Maps grounding', async () => {
    generateContent.mockResolvedValue(answer(good));
    await provider().analyzeImage(input);
    const config = generateContent.mock.calls[0][0].config;
    expect(config.tools).toEqual([{ googleMaps: {} }]);
    expect(config.responseMimeType).toBeUndefined();
  });

  it('separates real grounding queries from model-reported ones', async () => {
    generateContent.mockResolvedValue(
      answer(good, {
        webSearchQueries: ['real query'],
        groundingChunks: [{ maps: { uri: 'https://maps.google.com/?cid=1', title: 'Raekoja plats' } }],
      }),
    );
    const r = await provider().analyzeImage(input);
    expect(r.groundingQueries).toEqual(['real query']);
    expect(r.modelReportedQueries).toEqual(['claimed query']);
    expect(r.sources).toEqual([{ uri: 'https://maps.google.com/?cid=1', title: 'Raekoja plats', type: 'maps' }]);
    expect(r.model).toBe('gemini-3.8-flash');
  });

  it('retries once when the answer cannot be parsed', async () => {
    generateContent.mockResolvedValueOnce(answer('not json')).mockResolvedValueOnce(answer(good));
    const r = await provider().analyzeImage(input);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(r.locationName).toBe('Tallinn');
  });

  it('gives up with PARSE after two unreadable answers', async () => {
    generateContent.mockResolvedValue(answer('still not json'));
    await expect(provider().analyzeImage(input)).rejects.toMatchObject({ code: 'PARSE' });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('reports an empty answer as BLOCKED without retrying', async () => {
    generateContent.mockResolvedValue({ text: '', candidates: [{ finishReason: 'SAFETY' }] });
    await expect(provider().analyzeImage(input)).rejects.toBeInstanceOf(LocusError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default model when the chosen one is unavailable', async () => {
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('model not found'), { status: 404 }))
      .mockResolvedValueOnce(answer(good));
    const r = await provider('gemini-3.1-pro-preview').analyzeImage(input);
    expect(generateContent.mock.calls[1][0].model).toBe('gemini-3.8-flash');
    expect(r.modelFallbackFrom).toBe('gemini-3.1-pro-preview');
  });

  it('chats with the configured model when a stored result names an unknown model', async () => {
    generateContent.mockResolvedValue(answer(good));
    const result = { ...(await provider().analyzeImage(input)), model: 'unknown' };
    provider('gemini-3.5-flash').createChatSession({ base64Data: 'AAAA', mimeType: 'image/jpeg' }, result);
    expect(chatsCreate.mock.calls[0][0].model).toBe('gemini-3.5-flash');
  });
});
