import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Mirrors manifest.schema.json in Provereno-Media/locus-eval. */
const truthSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().positive(),
});

export const evalItemSchema = z
  .object({
    id: z.string().regex(/^e\d{3}$/),
    file: z.string().regex(/^images\/e\d{3}\.(jpg|png|webp)$/),
    difficulty: z.enum(['easy', 'medium', 'hard', 'unanswerable']),
    mode: z.enum(['visual', 'satellite', 'flora']),
    country: z.string().regex(/^[A-Z]{2}$/).nullish(),
    truth: truthSchema.nullable(),
    truthSource: z.string().min(1),
    context: z.string().optional(),
    source: z.object({
      kind: z.enum(['own-photo', 'provereno-published', 'open-license', 'other']),
      rights: z.string().min(1),
      author: z.string().optional(),
      license: z.string().optional(),
    }),
    publicUrls: z.array(z.string().url()).default([]),
    personalData: z.boolean().optional(),
    notes: z.string().optional(),
    addedAt: z.string(),
  })
  .refine((item) => (item.difficulty === 'unanswerable') === (item.truth === null), {
    message: 'truth must be null exactly for unanswerable items',
    path: ['truth'],
  });

export const manifestSchema = z.object({
  version: z.literal(1),
  items: z.array(evalItemSchema),
});

export type EvalItem = z.infer<typeof evalItemSchema>;

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function mimeTypeOf(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function parseManifest(raw: unknown): EvalItem[] {
  const manifest = manifestSchema.parse(raw);
  const ids = new Set<string>();
  for (const item of manifest.items) {
    if (ids.has(item.id)) throw new Error(`Duplicate id ${item.id}`);
    ids.add(item.id);
  }
  return manifest.items;
}

/** Reads <dir>/manifest.json and checks that every image file exists. */
export function loadManifest(dir: string, fileName = 'manifest.json'): EvalItem[] {
  const items = parseManifest(JSON.parse(readFileSync(path.join(dir, fileName), 'utf8')));
  const missing = items.filter((item) => !existsSync(path.join(dir, item.file)));
  if (missing.length > 0) {
    throw new Error(`Missing image files: ${missing.map((item) => item.file).join(', ')}`);
  }
  return items;
}
