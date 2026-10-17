import type { Coordinates, GeolocationResult } from '../../src/services/geo/types';
import type { EvalItem } from './manifest';

export const DISTANCE_BUCKETS_KM = [1, 25, 200, 750, 2500] as const;

/** Grounding hits on these hosts count as a possible leak for every item. */
export const ALWAYS_LEAKY_HOSTS = ['provereno.media'];

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function matchesHost(candidate: string, host: string): boolean {
  return candidate === host || candidate.endsWith(`.${host}`);
}

/**
 * Search grounding returns redirect URIs and puts the source domain in the title,
 * so both are checked. Matching is by host: any page on the host counts.
 */
export function findLeaks(sources: GeolocationResult['sources'], publicUrls: string[]): string[] {
  const hosts = [...ALWAYS_LEAKY_HOSTS, ...publicUrls.flatMap((u) => hostOf(u) ?? [])];
  return sources
    .filter((source) => {
      const candidates = [hostOf(source.uri), source.title.trim().toLowerCase().replace(/^www\./, '')];
      return candidates.some((c) => c && hosts.some((h) => matchesHost(c, h)));
    })
    .map((source) => `${source.title} <${source.uri}>`);
}

export interface Attempt {
  id: string;
  attempt: number;
  difficulty: EvalItem['difficulty'];
  durationMs: number;
  /** LocusError code when the analysis failed */
  error?: string;
  errorDetail?: string;
  locationName?: string;
  coordinates?: Coordinates | null;
  confidence?: number;
  distanceKm?: number | null;
  withinRadius?: boolean;
  abstained?: boolean;
  leaks: string[];
  groundingQueries: string[];
  sources: GeolocationResult['sources'];
  evidence?: string[];
  model?: string;
  modelFallbackFrom?: string;
}

export function scoreAttempt(
  item: EvalItem,
  attempt: number,
  durationMs: number,
  outcome: { result: GeolocationResult } | { error: string; errorDetail?: string },
): Attempt {
  const base = { id: item.id, attempt, difficulty: item.difficulty, durationMs };
  if ('error' in outcome) {
    return { ...base, error: outcome.error, errorDetail: outcome.errorDetail, leaks: [], groundingQueries: [], sources: [] };
  }
  const r = outcome.result;
  const distanceKm = item.truth && r.coordinates ? haversineKm(item.truth, r.coordinates) : null;
  return {
    ...base,
    locationName: r.locationName,
    coordinates: r.coordinates,
    confidence: r.confidence,
    distanceKm,
    withinRadius: item.truth ? distanceKm !== null && distanceKm <= item.truth.radiusKm : undefined,
    abstained: r.coordinates === null,
    leaks: findLeaks(r.sources, item.publicUrls),
    groundingQueries: r.groundingQueries,
    sources: r.sources,
    evidence: r.evidence,
    model: r.model,
    modelFallbackFrom: r.modelFallbackFrom,
  };
}

const share = (hits: number, total: number) => (total === 0 ? null : hits / total);
const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

export interface Summary {
  attempts: number;
  errors: number;
  leaked: number;
  /** Answerable attempts without leaks; errors count as misses */
  answerable: number;
  withinBucket: Record<string, number | null>;
  withinRadius: number | null;
  withinRadiusByDifficulty: Record<string, number | null>;
  medianDistanceKm: number | null;
  /** Unanswerable attempts without errors or leaks */
  unanswerable: number;
  abstainRate: number | null;
  /** Mean squared gap between confidence and withinRadius on answered attempts; lower is better */
  brier: number | null;
  meanConfidenceCorrect: number | null;
  meanConfidenceWrong: number | null;
  groundingQueriesTotal: number;
  groundingQueriesMean: number | null;
  meanDurationS: number | null;
  modelFallbacks: number;
}

export function summarize(attempts: Attempt[]): Summary {
  const clean = attempts.filter((a) => a.leaks.length === 0);
  const answerable = clean.filter((a) => a.difficulty !== 'unanswerable');
  const unanswerable = clean.filter((a) => a.difficulty === 'unanswerable' && !a.error);
  const answered = answerable.filter((a) => !a.error && a.withinRadius !== undefined);
  const distances = answerable.flatMap((a) => (a.distanceKm == null ? [] : [a.distanceKm])).sort((x, y) => x - y);

  const withinBucket: Record<string, number | null> = {};
  for (const km of DISTANCE_BUCKETS_KM) {
    withinBucket[`${km}km`] = share(answerable.filter((a) => a.distanceKm != null && a.distanceKm <= km).length, answerable.length);
  }

  const withinRadiusByDifficulty: Record<string, number | null> = {};
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const group = answerable.filter((a) => a.difficulty === difficulty);
    withinRadiusByDifficulty[difficulty] = share(group.filter((a) => a.withinRadius).length, group.length);
  }

  const queryCounts = attempts.filter((a) => !a.error).map((a) => a.groundingQueries.length);

  return {
    attempts: attempts.length,
    errors: attempts.filter((a) => a.error).length,
    leaked: attempts.length - clean.length,
    answerable: answerable.length,
    withinBucket,
    withinRadius: share(answerable.filter((a) => a.withinRadius).length, answerable.length),
    withinRadiusByDifficulty,
    medianDistanceKm: distances.length === 0 ? null : distances[Math.floor((distances.length - 1) / 2)],
    unanswerable: unanswerable.length,
    abstainRate: share(unanswerable.filter((a) => a.abstained).length, unanswerable.length),
    brier: mean(answered.map((a) => ((a.confidence ?? 0) - (a.withinRadius ? 1 : 0)) ** 2)),
    meanConfidenceCorrect: mean(answered.filter((a) => a.withinRadius).map((a) => a.confidence ?? 0)),
    meanConfidenceWrong: mean(answered.filter((a) => !a.withinRadius).map((a) => a.confidence ?? 0)),
    groundingQueriesTotal: queryCounts.reduce((a, b) => a + b, 0),
    groundingQueriesMean: mean(queryCounts),
    meanDurationS: mean(attempts.map((a) => a.durationMs / 1000)),
    modelFallbacks: attempts.filter((a) => a.modelFallbackFrom).length,
  };
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const num = (v: number | null, digits = 2) => (v === null ? '—' : v.toFixed(digits));

export function formatSummary(s: Summary): string {
  const buckets = Object.entries(s.withinBucket)
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(' · ');
  const byDifficulty = Object.entries(s.withinRadiusByDifficulty)
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(' · ');
  return [
    `Attempts: ${s.attempts} (errors ${s.errors}, possible leaks ${s.leaked}, model fallbacks ${s.modelFallbacks})`,
    `Answerable: ${s.answerable}; within item radius ${pct(s.withinRadius)} (${byDifficulty})`,
    `Within distance: ${buckets}; median ${s.medianDistanceKm === null ? '—' : `${s.medianDistanceKm.toFixed(1)} km`}`,
    `Unanswerable: ${s.unanswerable}; abstained ${pct(s.abstainRate)}`,
    `Calibration: Brier ${num(s.brier)}; mean confidence correct ${num(s.meanConfidenceCorrect)} / wrong ${num(s.meanConfidenceWrong)}`,
    `Grounding queries: ${s.groundingQueriesTotal} total, ${num(s.groundingQueriesMean, 1)} per answer; mean time ${num(s.meanDurationS, 0)} s`,
  ].join('\n');
}
