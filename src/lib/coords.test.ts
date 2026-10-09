import { describe, expect, it } from 'vitest';
import { formatDecimalPair, formatLatitude, formatLongitude } from './coords';

describe('coordinate formatting', () => {
  it('uses hemisphere letters by sign', () => {
    expect(formatLatitude(59.437)).toBe('59.4370° N');
    expect(formatLatitude(-33.8688)).toBe('33.8688° S');
    expect(formatLongitude(24.7536)).toBe('24.7536° E');
    expect(formatLongitude(-58.3816)).toBe('58.3816° W');
  });

  it('formats a decimal pair for copying', () => {
    expect(formatDecimalPair({ lat: -33.8688, lng: 151.2093 })).toBe('-33.868800, 151.209300');
  });
});
