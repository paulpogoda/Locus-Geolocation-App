export type AnalysisMode = 'visual' | 'satellite' | 'flora';
export type GroundingTool = 'search' | 'maps';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GroundingSource {
  uri: string;
  title: string;
  type: 'web' | 'maps';
}

export interface GeolocationResult {
  locationName: string;
  /** null when the model could not determine a location */
  coordinates: Coordinates | null;
  /** 0..1, self-reported by the model and not calibrated */
  confidence: number;
  evidence: string[];
  description: string;
  extractedText: string[];
  identifiedSymbols: string[];
  /** Queries the model claims it ran. Unverified. */
  modelReportedQueries: string[];
  /** Queries actually executed, taken from groundingMetadata. */
  groundingQueries: string[];
  sources: GroundingSource[];
  searchEntryPointHtml?: string;
  model: string;
  /** Set when the configured model was unavailable and the default was used instead */
  modelFallbackFrom?: string;
  mode: AnalysisMode;
  groundingTool: GroundingTool;
  analyzedAt: string;
}

export interface ImageInput {
  base64Data: string;
  mimeType: string;
}

export interface AnalyzeImageInput extends ImageInput {
  mode: AnalysisMode;
  groundingTool: GroundingTool;
}

export interface ChatSession {
  sendMessage(text: string): Promise<string>;
}

/**
 * Transport-agnostic geolocation backend (ADR-001).
 * Free tier: DirectGeminiProvider (browser -> Gemini, user's key).
 * Pro tier (later): ServerProxyProvider (browser -> /api -> Gemini).
 */
export interface GeoProvider {
  readonly id: string;
  analyzeImage(input: AnalyzeImageInput): Promise<GeolocationResult>;
  createChatSession(image: ImageInput, result: GeolocationResult): ChatSession;
}
