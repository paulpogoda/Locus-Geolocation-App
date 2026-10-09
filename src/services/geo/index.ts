import { DirectGeminiProvider } from './directGeminiProvider';
import type { GeoProvider } from './types';

export * from './types';
export { LocusError } from './errors';
export { normalizeStoredResult } from './schema';

const directProvider = new DirectGeminiProvider();

/** Single switch point between Free (direct) and future Pro (server proxy) providers. */
export function getGeoProvider(): GeoProvider {
  return directProvider;
}
