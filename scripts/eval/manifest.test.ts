import { describe, expect, it } from 'vitest';
import { mimeTypeOf, parseManifest } from './manifest';

const entry = {
  id: 'e001',
  file: 'images/e001.jpg',
  difficulty: 'easy',
  mode: 'visual',
  truth: { lat: 59.437, lng: 24.7536, radiusKm: 1 },
  truthSource: 'test',
  source: { kind: 'own-photo', rights: 'test' },
  addedAt: '2026-10-16',
};

describe('parseManifest', () => {
  it('accepts a valid manifest and defaults publicUrls', () => {
    const [item] = parseManifest({ version: 1, items: [entry] });
    expect(item.publicUrls).toEqual([]);
  });

  it('requires truth exactly for answerable items', () => {
    expect(() => parseManifest({ version: 1, items: [{ ...entry, truth: null }] })).toThrow();
    expect(() => parseManifest({ version: 1, items: [{ ...entry, difficulty: 'unanswerable' }] })).toThrow();
    expect(parseManifest({ version: 1, items: [{ ...entry, difficulty: 'unanswerable', truth: null }] })).toHaveLength(1);
  });

  it('rejects duplicate ids and file names other than the id', () => {
    expect(() => parseManifest({ version: 1, items: [entry, entry] })).toThrow('Duplicate id e001');
    expect(() => parseManifest({ version: 1, items: [{ ...entry, file: 'images/IMG_2041.jpg' }] })).toThrow();
  });
});

describe('mimeTypeOf', () => {
  it('maps the allowed extensions', () => {
    expect(mimeTypeOf('images/e001.jpg')).toBe('image/jpeg');
    expect(mimeTypeOf('images/e001.webp')).toBe('image/webp');
  });
});
