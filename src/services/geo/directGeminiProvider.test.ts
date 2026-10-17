import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
// Analysis requests are streamed; by default a stream yields the mocked answer as one chunk.
const generateContentStream = vi.fn(async (params: any) => {
  const response = await generateContent(params);
  return (async function* () {
    yield response;
  })();
});
const chatsCreate = vi.fn();
const ctorArgs: unknown[] = [];

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream };
    chats = { create: chatsCreate };
    constructor(opts: unknown) {
      ctorArgs.push(opts);
    }
  },
}));

const { DirectGeminiProvider, collectAnswer } = await import('./directGeminiProvider');
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
  generateContentStream.mockClear();
  chatsCreate.mockReset();
  ctorArgs.length = 0;
});

describe('DirectGeminiProvider', () => {
  it('requires a key', async () => {
    const p = new DirectGeminiProvider(() => ({ apiKey: '', modelName: 'gemini-3.8-flash' }));
    await expect(p.analyzeImage(input)).rejects.toMatchObject({ code: 'NO_KEY' });
  });

  it('rejects a key with invalid characters before sending anything', async () => {
    const p = new DirectGeminiProvider(() => ({ apiKey: 'AIzaКИР', modelName: 'gemini-2.5-flash' }));
    await expect(p.analyzeImage(input)).rejects.toMatchObject({ code: 'BAD_KEY' });
    expect(generateContent).not.toHaveBeenCalled();
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
    expect(generateContent.mock.calls[1][0].model).toBe('gemini-3.6-flash');
    expect(r.modelFallbackFrom).toBe('gemini-3.1-pro-preview');
  });

  it('reports a grounding-only quota error when a plain request passes', async () => {
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('You exceeded your current quota'), { status: 429 }))
      .mockResolvedValueOnce({ text: 'pong' });
    await expect(provider().analyzeImage(input)).rejects.toMatchObject({ code: 'GROUNDING_QUOTA' });
    const probe = generateContent.mock.calls[1][0];
    expect(probe.config?.tools).toBeUndefined();
    expect(probe.model).toBe('gemini-3.8-flash');
  });

  it('keeps the quota error when a plain request also fails', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('You exceeded your current quota'), { status: 429 }));
    await expect(provider().analyzeImage(input)).rejects.toMatchObject({ code: 'QUOTA' });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('does not probe on other errors', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('API key not valid'), { status: 400 }));
    await expect(provider().analyzeImage(input)).rejects.toMatchObject({ code: 'AUTH' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default model when the chosen one is retired for new users', async () => {
    generateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('This model models/gemini-3.5-flash is no longer available to new users.'), { status: 404 }),
      )
      .mockResolvedValueOnce(answer(good));
    const r = await provider('gemini-3.5-flash').analyzeImage(input);
    expect(generateContent.mock.calls[1][0].model).toBe('gemini-3.6-flash');
    expect(r.modelFallbackFrom).toBe('gemini-3.5-flash');
  });

  it('reports a retired default model clearly', async () => {
    generateContent.mockRejectedValue(
      Object.assign(new Error('This model models/gemini-3.6-flash is no longer available to new users.'), { status: 404 }),
    );
    await expect(provider('gemini-3.6-flash').analyzeImage(input)).rejects.toMatchObject({ code: 'MODEL_RETIRED' });
  });

  it('streams the analysis and asks for thought summaries to keep the connection busy', async () => {
    generateContent.mockResolvedValue(answer(good));
    await provider().analyzeImage(input);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(generateContentStream.mock.calls[0][0].config.thinkingConfig).toEqual({ includeThoughts: true });
  });

  it('joins streamed chunks, skipping thought summaries', () => {
    const r = collectAnswer([
      { candidates: [{ content: { parts: [{ text: 'thinking about signs', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: '{"locationName":' }] } }] },
      {
        candidates: [
          {
            content: { parts: [{ text: '"Tallinn"}' }] },
            finishReason: 'STOP',
            groundingMetadata: { webSearchQueries: ['q'] },
          },
        ],
      },
    ] as never);
    expect(r.text).toBe('{"locationName":"Tallinn"}');
    expect(r.finishReason).toBe('STOP');
    expect(r.groundingMetadata).toEqual({ webSearchQueries: ['q'] });
  });

  it('reports how long a dropped connection lasted', async () => {
    generateContentStream.mockImplementationOnce(async () =>
      (async function* () {
        yield { candidates: [{ content: { parts: [{ text: '...', thought: true }] } }] };
        throw new TypeError('Failed to fetch');
      })(),
    );
    const error = await provider().analyzeImage(input).catch((e) => e);
    expect(error).toMatchObject({ code: 'NETWORK' });
    expect(error.detail).toMatch(/^connection closed after \d+ s; the request may still have been processed and billed$/);
  });

  it('chats with the configured model when a stored result names an unknown model', async () => {
    generateContent.mockResolvedValue(answer(good));
    const result = { ...(await provider().analyzeImage(input)), model: 'unknown' };
    provider('gemini-3.5-flash').createChatSession({ base64Data: 'AAAA', mimeType: 'image/jpeg' }, result);
    expect(chatsCreate.mock.calls[0][0].model).toBe('gemini-3.5-flash');
  });
});
