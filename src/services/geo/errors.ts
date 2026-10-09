export type LocusErrorCode =
  | 'NO_KEY'
  | 'AUTH'
  | 'QUOTA'
  | 'REGION'
  | 'MODEL_UNAVAILABLE'
  | 'BLOCKED'
  | 'PARSE'
  | 'NETWORK'
  | 'UNKNOWN';

const MESSAGES: Record<LocusErrorCode, string> = {
  NO_KEY: 'Gemini API key is not set. Open Settings to add your key.',
  AUTH: 'Gemini rejected the API key. Check the key in Settings.',
  QUOTA: 'Gemini rate limit or quota exceeded. Try again later or use another key.',
  REGION: 'Gemini API is not available in your region.',
  MODEL_UNAVAILABLE: 'The selected model is not available for this key. Choose another model in Settings.',
  BLOCKED: 'Gemini returned no answer for this image (blocked or empty response).',
  PARSE: 'The model answered, but the result could not be read. Try again or switch the grounding mode.',
  NETWORK: 'Could not reach Gemini API. Check your connection.',
  UNKNOWN: 'Gemini API request failed.',
};

export class LocusError extends Error {
  readonly code: LocusErrorCode;
  readonly detail?: string;

  constructor(code: LocusErrorCode, detail?: string) {
    super(MESSAGES[code]);
    this.name = 'LocusError';
    this.code = code;
    this.detail = detail;
  }
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export function mapGeminiError(error: unknown): LocusError {
  if (error instanceof LocusError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();
  const status = statusOf(error);

  if (text.includes('api key not valid') || text.includes('api_key_invalid') || status === 401) {
    return new LocusError('AUTH', message);
  }
  if (text.includes('location is not supported') || text.includes('user location')) {
    return new LocusError('REGION', message);
  }
  if (status === 429 || text.includes('resource_exhausted') || text.includes('quota')) {
    return new LocusError('QUOTA', message);
  }
  if (status === 404 || (text.includes('model') && text.includes('not found'))) {
    return new LocusError('MODEL_UNAVAILABLE', message);
  }
  if (status === 403 || text.includes('permission_denied')) {
    return new LocusError('AUTH', message);
  }
  if (error instanceof TypeError && text.includes('fetch')) {
    return new LocusError('NETWORK', message);
  }
  return new LocusError('UNKNOWN', message);
}
