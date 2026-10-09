import { z } from 'zod';
import type { Coordinates, GeolocationResult } from './types';

// zod probes `new Function` to enable its JIT; the CSP forbids eval, so skip the probe.
z.config({ jitless: true });

const toNumber = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

/** Accepts numbers, numeric strings and strings like "59.43° N" / "24.75 W". */
const toCoordinate = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?\s*$/.exec(value);
  if (!m) return Number.NaN;
  const n = Number(m[1]);
  return m[2] && /[SWsw]/.test(m[2]) ? -Math.abs(n) : n;
};

const stringList = z
  .array(z.unknown())
  .nullish()
  .transform((items) =>
    (items ?? []).filter((item): item is string => typeof item === 'string' && item.trim() !== ''),
  );

const coordinatesSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') return null;
    const { lat, lng } = value as { lat?: unknown; lng?: unknown };
    if (lat == null || lng == null) return null;
    return { lat: toCoordinate(lat), lng: toCoordinate(lng) };
  },
  z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .nullable()
    // (0, 0) is a common placeholder for "unknown"; treat it as no answer.
    .transform((c): Coordinates | null => (c && (c.lat !== 0 || c.lng !== 0) ? c : null)),
).catch(null); // unusable coordinates mean "not determined", not a failed analysis

const confidenceSchema = z.preprocess(
  toNumber,
  z
    .number()
    .min(0)
    .max(100)
    .transform((v) => (v > 1 ? v / 100 : v)),
);

/** Shape the prompt asks the model to return. */
export const modelGeolocationSchema = z.object({
  locationName: z
    .string()
    .nullish()
    .transform((v) => v?.trim() || 'Location not determined'),
  coordinates: coordinatesSchema,
  confidence: confidenceSchema.catch(0),
  evidence: stringList,
  description: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  extractedText: stringList,
  identifiedSymbols: stringList,
  searchQueriesExecuted: stringList,
});

export type ModelGeolocation = z.infer<typeof modelGeolocationSchema>;

/**
 * Returns the first top-level JSON object in a model answer,
 * tolerating markdown fences and prose around it.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export type ParseOutcome =
  | { ok: true; data: ModelGeolocation }
  | { ok: false; error: string };

export function parseModelGeolocation(text: string): ParseOutcome {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, error: 'No JSON object in model response' };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }

  const parsed = modelGeolocationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }

  const data = parsed.data;
  if (!data.coordinates) data.confidence = 0;
  return { ok: true, data };
}

const storedSourceSchema = z.object({
  uri: z.string(),
  title: z.string(),
  type: z.enum(['web', 'maps']),
});

/**
 * Reads a result saved in history, including the pre-0.4 format
 * (searchQueriesExecuted, no metadata fields). Returns null if unusable.
 */
const storedGeolocationSchema = z.object({
  locationName: modelGeolocationSchema.shape.locationName.catch('Location not determined'),
  coordinates: coordinatesSchema,
  confidence: confidenceSchema.catch(0),
  evidence: stringList.catch([]),
  description: modelGeolocationSchema.shape.description.catch(''),
  extractedText: stringList.catch([]),
  identifiedSymbols: stringList.catch([]),
});

export function normalizeStoredResult(raw: unknown): GeolocationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const base = storedGeolocationSchema.safeParse(raw);
  if (!base.success) return null;
  const r = raw as Record<string, unknown>;

  const sources = z.array(storedSourceSchema).catch([]).parse(r.sources ?? []);
  const groundingQueries = stringList.catch([]).parse(r.groundingQueries);
  const modelReportedQueries = stringList.catch([]).parse(r.modelReportedQueries ?? r.searchQueriesExecuted);

  return {
    locationName: base.data.locationName,
    coordinates: base.data.coordinates,
    confidence: base.data.coordinates ? base.data.confidence : 0,
    evidence: base.data.evidence,
    description: base.data.description,
    extractedText: base.data.extractedText,
    identifiedSymbols: base.data.identifiedSymbols,
    modelReportedQueries,
    groundingQueries,
    sources,
    searchEntryPointHtml: typeof r.searchEntryPointHtml === 'string' ? r.searchEntryPointHtml : undefined,
    model: typeof r.model === 'string' ? r.model : 'unknown',
    modelFallbackFrom: typeof r.modelFallbackFrom === 'string' ? r.modelFallbackFrom : undefined,
    mode: r.mode === 'satellite' || r.mode === 'flora' ? r.mode : 'visual',
    groundingTool: r.groundingTool === 'search' ? 'search' : 'maps',
    analyzedAt: typeof r.analyzedAt === 'string' ? r.analyzedAt : new Date(0).toISOString(),
  };
}
