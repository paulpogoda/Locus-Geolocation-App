import { describe, expect, it } from 'vitest';
import { LocusError, mapGeminiError } from './errors';

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('mapGeminiError', () => {
  it.each([
    [apiError(400, 'API key not valid. Please pass a valid API key.'), 'AUTH'],
    [apiError(429, 'RESOURCE_EXHAUSTED'), 'QUOTA'],
    [apiError(404, 'models/gemini-x is not found for API version v1beta'), 'MODEL_UNAVAILABLE'],
    [apiError(400, 'User location is not supported for the API use.'), 'REGION'],
    [apiError(403, 'PERMISSION_DENIED'), 'AUTH'],
    [new TypeError('Failed to fetch'), 'NETWORK'],
    [new Error('something odd'), 'UNKNOWN'],
  ])('maps %s to %s', (error, code) => {
    expect(mapGeminiError(error).code).toBe(code);
  });

  it('passes LocusError through', () => {
    const e = new LocusError('PARSE');
    expect(mapGeminiError(e)).toBe(e);
  });

  it('keeps the raw message as detail', () => {
    expect(mapGeminiError(apiError(429, 'quota')).detail).toBe('quota');
  });
});
