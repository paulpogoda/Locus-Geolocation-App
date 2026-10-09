import type { GroundingMetadata } from '@google/genai';
import type { GroundingSource } from './types';

export interface GroundingSummary {
  sources: GroundingSource[];
  groundingQueries: string[];
  searchEntryPointHtml?: string;
}

export function extractGrounding(metadata: GroundingMetadata | undefined): GroundingSummary {
  if (!metadata) return { sources: [], groundingQueries: [] };

  const sources: GroundingSource[] = [];
  const seen = new Set<string>();

  for (const chunk of metadata.groundingChunks ?? []) {
    if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
      seen.add(chunk.web.uri);
      sources.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri, type: 'web' });
    }
    if (chunk.maps?.uri && !seen.has(chunk.maps.uri)) {
      seen.add(chunk.maps.uri);
      sources.push({ uri: chunk.maps.uri, title: chunk.maps.title || 'Google Maps', type: 'maps' });
    }
  }

  const groundingQueries = Array.from(
    new Set((metadata.webSearchQueries ?? []).filter((q) => q.trim() !== '')),
  );

  return {
    sources,
    groundingQueries,
    searchEntryPointHtml: metadata.searchEntryPoint?.renderedContent || undefined,
  };
}
