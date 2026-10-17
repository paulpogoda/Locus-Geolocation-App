import { describe, expect, it } from 'vitest';
import type { GeolocationResult } from '../../src/services/geo/types';
import type { EvalItem } from './manifest';
import { findLeaks, haversineKm, scoreAttempt, summarize } from './metrics';

const tallinn = { lat: 59.43696, lng: 24.75353 };

function item(overrides: Partial<EvalItem> = {}): EvalItem {
  return {
    id: 'e001',
    file: 'images/e001.jpg',
    difficulty: 'medium',
    mode: 'visual',
    truth: { ...tallinn, radiusKm: 1 },
    truthSource: 'test',
    source: { kind: 'own-photo', rights: 'test' },
    publicUrls: [],
    addedAt: '2026-10-16',
    ...overrides,
  };
}

function result(overrides: Partial<GeolocationResult> = {}): GeolocationResult {
  return {
    locationName: 'Tallinn',
    coordinates: tallinn,
    confidence: 0.8,
    evidence: [],
    description: '',
    extractedText: [],
    identifiedSymbols: [],
    modelReportedQueries: [],
    groundingQueries: ['q1', 'q2'],
    sources: [],
    model: 'gemini-3.6-flash',
    mode: 'visual',
    groundingTool: 'maps',
    analyzedAt: '2026-10-16T00:00:00Z',
    ...overrides,
  };
}

describe('haversineKm', () => {
  it('measures known distances', () => {
    expect(haversineKm(tallinn, tallinn)).toBe(0);
    // Tallinn – Helsinki, about 82 km
    expect(haversineKm(tallinn, { lat: 60.16952, lng: 24.93545 })).toBeCloseTo(82, 0);
  });
});

describe('findLeaks', () => {
  it('flags Provereno and the item public pages by URI host or source title', () => {
    const sources = [
      { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'provereno.media', type: 'web' as const },
      { uri: 'https://news.example.org/story', title: 'Story', type: 'web' as const },
      { uri: 'https://maps.google.com/?cid=1', title: 'Town Hall', type: 'maps' as const },
    ];
    expect(findLeaks(sources, [])).toHaveLength(1);
    expect(findLeaks(sources, ['https://www.example.org/x'])).toHaveLength(2);
  });

  it('does not match unrelated hosts that only end with the same letters', () => {
    const sources = [{ uri: 'https://notexample.org/a', title: 'notexample.org', type: 'web' as const }];
    expect(findLeaks(sources, ['https://example.org/'])).toEqual([]);
  });
});

describe('scoreAttempt', () => {
  it('marks answers inside the item radius as correct', () => {
    const near = scoreAttempt(item(), 1, 1000, { result: result({ coordinates: { lat: 59.437, lng: 24.754 } }) });
    expect(near.withinRadius).toBe(true);
    const far = scoreAttempt(item(), 1, 1000, { result: result({ coordinates: { lat: 60.1695, lng: 24.9354 } }) });
    expect(far.withinRadius).toBe(false);
    const none = scoreAttempt(item(), 1, 1000, { result: result({ coordinates: null }) });
    expect(none).toMatchObject({ withinRadius: false, distanceKm: null, abstained: true });
  });

  it('records errors without a result', () => {
    const failed = scoreAttempt(item(), 1, 1000, { error: 'PARSE', errorDetail: 'bad json' });
    expect(failed).toMatchObject({ error: 'PARSE', leaks: [], groundingQueries: [] });
  });
});

describe('summarize', () => {
  it('counts errors as misses, keeps leaks out and scores abstention on unanswerable items', () => {
    const unanswerable = item({ id: 'e009', difficulty: 'unanswerable', truth: null });
    const leakySource = [{ uri: 'https://provereno.media/a', title: 'provereno.media', type: 'web' as const }];
    const s = summarize([
      scoreAttempt(item(), 1, 2000, { result: result({ confidence: 1 }) }),
      scoreAttempt(item({ id: 'e002' }), 1, 2000, { result: result({ coordinates: { lat: 0.5, lng: 0.5 }, confidence: 0.6 }) }),
      scoreAttempt(item({ id: 'e003' }), 1, 2000, { error: 'NETWORK' }),
      scoreAttempt(item({ id: 'e004' }), 1, 2000, { result: result({ sources: leakySource }) }),
      scoreAttempt(unanswerable, 1, 2000, { result: result({ coordinates: null, confidence: 0 }) }),
    ]);
    expect(s).toMatchObject({ attempts: 5, errors: 1, leaked: 1, answerable: 3, unanswerable: 1, abstainRate: 1 });
    expect(s.withinRadius).toBeCloseTo(1 / 3);
    expect(s.withinBucket['2500km']).toBeCloseTo(1 / 3);
    // (1 - 1)^2 and (0.6 - 0)^2 over two answered attempts
    expect(s.brier).toBeCloseTo(0.18);
    expect(s.groundingQueriesTotal).toBe(8);
  });

  it('handles an empty run', () => {
    expect(summarize([])).toMatchObject({ attempts: 0, withinRadius: null, brier: null, medianDistanceKm: null });
  });
});
