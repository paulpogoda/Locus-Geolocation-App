import type { Coordinates } from '../services/geo/types';

export function formatLatitude(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`;
}

export function formatLongitude(lng: number): string {
  return `${Math.abs(lng).toFixed(4)}° ${lng < 0 ? 'W' : 'E'}`;
}

/** Decimal "lat, lng" for pasting into maps and search tools. */
export function formatDecimalPair(c: Coordinates): string {
  return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
}
