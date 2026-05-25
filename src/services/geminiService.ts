import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

const ANALYSIS_MODEL =
  import.meta.env.VITE_GEMINI_ANALYSIS_MODEL || "gemini-2.5-flash";

const CHAT_MODEL =
  import.meta.env.VITE_GEMINI_CHAT_MODEL || "gemini-2.5-flash";

const ANALYSIS_FALLBACK_MODELS = (
  import.meta.env.VITE_GEMINI_ANALYSIS_FALLBACK_MODELS || ""
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

const TRANSIENT_RETRY_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_MS = 2000;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseApiError(error: unknown): {
  code?: number;
  status?: string;
  message: string;
} {
  const fallbackMessage =
    error instanceof Error ? error.message : JSON.stringify(error);

  try {
    const parsed = JSON.parse(fallbackMessage) as {
      error?: { code?: number; message?: string; status?: string };
    };
    if (parsed.error) {
      return {
        code: parsed.error.code,
        status: parsed.error.status,
        message: parsed.error.message || fallbackMessage,
      };
    }
  } catch {
    // Not JSON — use raw message.
  }

  const err = error as { status?: number | string; code?: number };
  return {
    code: typeof err?.status === "number" ? err.status : err?.code,
    status: typeof err?.status === "string" ? err.status : undefined,
    message: fallbackMessage,
  };
}

function isTransientApiError(error: unknown): boolean {
  const { code, status, message } = parseApiError(error);
  if (code === 503 || code === 429) return true;
  if (status === "UNAVAILABLE" || status === "RESOURCE_EXHAUSTED") return true;
  return /high demand|try again later|overloaded|rate limit|quota/i.test(message);
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.filter(Boolean))];
}

function formatGeminiApiError(
  error: unknown,
  modelsTried: string[],
  groundingTool: string
): Error {
  const { code, status, message } = parseApiError(error);
  const modelList = modelsTried.join(" → ");

  if (code === 503 || status === "UNAVAILABLE") {
    return new Error(
      `Gemini is temporarily overloaded (503). Wait a minute and retry, or set VITE_GEMINI_ANALYSIS_FALLBACK_MODELS in .env.local (e.g. gemini-2.0-flash). Models tried: ${modelList}. Tool: ${groundingTool}.`
    );
  }

  if (code === 429 || status === "RESOURCE_EXHAUSTED") {
    return new Error(
      `Gemini API quota or rate limit exceeded (429). Check billing/limits in Google AI Studio. Model: ${modelsTried[modelsTried.length - 1]}. Tool: ${groundingTool}.`
    );
  }

  return new Error(
    `Failed to call the Gemini API: ${message}. Models tried: ${modelList}. Tool: ${groundingTool}`
  );
}

async function generateAnalysisContent(
  params: Omit<Parameters<typeof ai.models.generateContent>[0], "model">,
  groundingTool: "search" | "maps"
): Promise<GenerateContentResponse> {
  const models = uniqueModels([ANALYSIS_MODEL, ...ANALYSIS_FALLBACK_MODELS]);
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < TRANSIENT_RETRY_ATTEMPTS; attempt++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (error) {
        lastError = error;
        const canRetry =
          isTransientApiError(error) && attempt < TRANSIENT_RETRY_ATTEMPTS - 1;

        if (canRetry) {
          await sleep(TRANSIENT_RETRY_BASE_MS * 2 ** attempt);
          continue;
        }

        if (!isTransientApiError(error)) {
          throw formatGeminiApiError(error, models.slice(0, models.indexOf(model) + 1), groundingTool);
        }
        break;
      }
    }
  }

  throw formatGeminiApiError(lastError, models, groundingTool);
}

export interface GeolocationResult {
  locationName: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  confidence: number;
  evidence: string[];
  description: string;
  extractedText?: string[];
  identifiedSymbols?: string[];
  searchQueriesExecuted?: string[];
  sources?: { uri: string; title: string; type: 'web' | 'maps' }[];
  searchEntryPointHtml?: string;
}

export interface ChatSession {
  sendMessage(text: string): Promise<string>;
}

export function createOsintChatSession(
  base64Data: string,
  mimeType: string,
  result: GeolocationResult,
  c2paContext?: string
): ChatSession {
  const systemInstruction = `You are a specialized OSINT (Open Source Intelligence) assistant called "LOCUS" embedded in an analytical engine. 
The system engine has already processed an image provided by the user with the following findings:
- Estimated Location: ${result.locationName}
- Coordinates: ${result.coordinates.lat.toFixed(4)}, ${result.coordinates.lng.toFixed(4)}
- Confidence Score: ${(result.confidence * 100).toFixed(1)}%
- System Heuristic Summary: ${result.description}
- Identifiable Evidentiary Features: ${result.evidence.join('; ')}
- Content Credentials (C2PA): ${c2paContext || "Not scanned or unavailable."}

Your task is to answer user questions about this image and the system's conclusions.
When appropriate, carefully reference specific details like architectural styles, language/text, infrastructure variants (e.g. road lines, poles), and environmental clues (flora, terrain, shadow angles).
Provide concise, expert, and precise answers. Maintain a professional, detached, and slightly clinical "intelligence analyst" persona.`;

  const chat = ai.chats.create({
    model: CHAT_MODEL,
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.3,
    }
  });

  let isFirstMessage = true;

  return {
    async sendMessage(text: string): Promise<string> {
      try {
        let response;
        if (isFirstMessage) {
          isFirstMessage = false;
          response = await chat.sendMessage({
            message: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType,
                },
              },
              { text: text }
            ]
          });
        } else {
          response = await chat.sendMessage({ message: text });
        }
        return response.text || "";
      } catch (error) {
        console.error("Chat error:", error);
        throw new Error("Chat system failed to respond.");
      }
    }
  };
}

export type AnalysisMode = 'visual' | 'satellite' | 'flora';

function extractResponseText(response: GenerateContentResponse): string {
  if (response.text?.trim()) {
    return response.text.trim();
  }

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }

  return null;
}

function sanitizeJsonString(json: string): string {
  return json
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseGeolocationJson(text: string): GeolocationResult {
  const jsonString = extractJsonObject(text);
  if (!jsonString) {
    throw new Error("No JSON object found in model response.");
  }

  const sanitized = sanitizeJsonString(jsonString);
  let parsed: unknown;

  try {
    parsed = JSON.parse(sanitized);
  } catch (parseError) {
    const message =
      parseError instanceof Error ? parseError.message : "Invalid JSON syntax";
    throw new Error(`${message} (response length: ${text.length})`);
  }

  return normalizeGeolocationResult(parsed);
}

function normalizeGeolocationResult(raw: unknown): GeolocationResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Parsed value is not a JSON object.");
  }

  const data = raw as Record<string, unknown>;
  const coords = data.coordinates;

  if (!coords || typeof coords !== "object") {
    throw new Error('Missing or invalid "coordinates" field.');
  }

  const coordRecord = coords as Record<string, unknown>;
  const lat = Number(coordRecord.lat);
  const lng = Number(coordRecord.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Coordinates must be numeric "lat" and "lng".');
  }

  const toStringArray = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    return value.map((item) => String(item));
  };

  const evidence = toStringArray(data.evidence) ?? [];
  const confidenceRaw = Number(data.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw))
    : 0;

  const locationName =
    typeof data.locationName === "string" && data.locationName.trim()
      ? data.locationName.trim()
      : "Unknown location";

  const description =
    typeof data.description === "string" && data.description.trim()
      ? data.description.trim()
      : "No description provided.";

  return {
    locationName,
    coordinates: { lat, lng },
    confidence,
    evidence,
    description,
    extractedText: toStringArray(data.extractedText),
    identifiedSymbols: toStringArray(data.identifiedSymbols),
    searchQueriesExecuted: toStringArray(data.searchQueriesExecuted),
  };
}

export async function geolocateImage(base64Data: string, mimeType: string, mode: AnalysisMode = 'visual', groundingTool: 'search' | 'maps' = 'maps'): Promise<GeolocationResult> {
  let prompt = `Act as an expert OSINT (Open Source Intelligence) analyst specializing in image geolocation.
  Your goal is to determine the precise geographic location shown in the image by following a rigorous evidence-based workflow. Tone should be neutral, skeptical, and strictly evidence-based.
  Crucial Rule: Do NOT speculate beyond what is visually confirmed in the image. If a feature is not present, explicitly state "Not visible" or use null. Do not guess coordinates unless the location contains verifiable landmarks.
  
  Meticulously perform the following steps:
  1. DEDICATED OCR & SYMBOL PASS (EXTREME ATTENTION TO DETAIL REQUIRED):
     - Scan the entire image for text, meticulously analyzing challenging areas with low light, glare, motion blur, steep angles, or extremely small font sizes in the far background.
     - Use structural and contextual clues to reconstruct partially obscured, degraded, or ambiguous text.
     - Transcribe ALL readable text exactly in its original script. Translate to English in brackets.
     - Analyze FONT STYLES and TYPOGRAPHICAL CONVENTIONS (e.g., European vs. American date formats, specific road sign fonts like Transport vs. FHWA).
     - Identify all symbols (corporate branding, crests, political stickers, infrastructure iconography).
     
  2. VISUAL EXTRACTION: Identify every significant detail:
     - LANDMARKS & ARCHITECTURE: Identifiable buildings, architectural styles (e.g., brutalism, Ottoman, Haussmann), window frame types, balcony and roof designs characteristic of specific countries or periods.
     - LANDSCAPE & ENVIRONMENT: Terrain, vegetation (e.g., taiga, tropical, steppe), bodies of water, soil type.
     - BIOLOGICAL INDICATORS: Visible plant species or animals. Note whether they are endemic or exotic.
     - VEHICLES: Make/model, license plate details (color scheme, format, readable text), steering wheel position (LHD/RHD).
     - INFRASTRUCTURE: Road markings (e.g., yellow vs. white lines), traffic signs, utility pole shapes, power line configurations, street signs, infrastructure symbols. Mobile operator branding or telephone booth colors if visible.
     - LIGHTING ANALYSIS: Sun azimuth (left/right/behind camera), shadow direction and length, estimated time of day, visible season indicators (snow, foliage, dry grass).
     - HUMAN INDICATORS: Clothing styles, visible uniforms, military or police insignia, logos on clothing or equipment.
  
  3. EXPLICIT MULTI-QUERY GROUNDING & VERIFICATION:
     - Generate and execute *multiple* specific search queries. Do not rely on just one attempt.
     - Generate queries that combine elements (e.g., ["exact extracted text" + "suspected city name", "phone number", "unique symbol description"]).
     - Translate detected words to English for generic searches, AND search the local language directly on maps.
     - Use ${groundingTool === 'maps' ? 'the Google Maps tool' : 'Google Search'} to thoroughly query these features. 
     - Verify if the architectural style, infrastructure, and vegetation match the suspected region.
  
  4. CHAIN OF THOUGHT & DEDUCTION: 
     - Broad region hypothesis: Deduce the broad region (e.g., "Left-hand traffic and tropical vegetation suggest Southeast Asia...").
     - Country/City narrowing: Narrow down the country and city based on language, architecture, and infrastructure. Cross-reference all clues to achieve street-level precision if possible.
     - Conflicting clues: Explicitly list any cues that contradict the main hypothesis and explain how you resolve the conflict.
     - Eliminated hypotheses: List alternative countries/regions you considered and the reason each was eliminated.
  
  MODE FOCUS: ${mode === 'satellite' ? ' structural layout, road networks, and topography from an overhead view' : mode === 'flora' ? 'botanical signatures, biomes, and climate zones' : 'general visual cues'}.
  
  You MUST respond with ONLY a single raw JSON object — no markdown, no code fences, no commentary before or after.
  Match this structure exactly:
  {
    "locationName": "Precise name (e.g. 123 Main St, Berlin, Germany)",
    "coordinates": { "lat": number, "lng": number },
    "confidence": 0-1,
    "extractedText": ["Literal Text [English Translation] (Font/Style analysis)"],
    "identifiedSymbols": ["Description of symbol"],
    "searchQueriesExecuted": ["Query 1", "Query 2"],
    "evidence": ["e.g. Utility pole design matches Polish Standard...", "e.g. Text is Cyrillic, likely Ukrainian..."],
    "description": "A detailed step-by-step reasoning of how you arrived at this location, including broad region hypothesis, verification searches steps, resolution of conflicting clues, and why alternative regions were eliminated."
  }`;

  let response: GenerateContentResponse;
  try {
    response = await generateAnalysisContent(
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType,
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          // Grounding tools cannot be combined with responseMimeType JSON (API returns 400).
          tools: [
            groundingTool === "maps"
              ? { googleMaps: { enableWidget: true } }
              : { googleSearch: {} },
          ],
        },
      },
      groundingTool
    );
  } catch (error) {
    console.error("Gemini API Error details:", error);
    throw error instanceof Error ? error : formatGeminiApiError(error, [ANALYSIS_MODEL], groundingTool);
  }

  try {
    const text = extractResponseText(response);
    if (!text) {
      throw new Error("Model returned an empty response.");
    }

    const result = parseGeolocationJson(text);
    
    // Extract grounding entry point (Web Search HTML widget)
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    if (groundingMetadata?.searchEntryPoint?.renderedContent) {
      result.searchEntryPointHtml = groundingMetadata.searchEntryPoint.renderedContent;
    } else if (groundingMetadata?.googleMapsWidgetContextToken) {
      // Actually, how to render this token? For now, we will store it, although we might not use it directly without a specific JS library.
      // E.g., we could pass it to the UI and if there's a specialized map widget, use it.
      // But since we are asked just to test Google Maps Grounding, making the code robust is priority.
    }
    
    // Extract grounding sources if available (Web and Maps)
    const groundingChunks = groundingMetadata?.groundingChunks;
    if (groundingChunks) {
      const sources: { uri: string; title: string; type: 'web' | 'maps' }[] = [];
      
      groundingChunks.forEach(chunk => {
        if (chunk.web) {
          sources.push({
            uri: chunk.web.uri || '',
            title: chunk.web.title || 'Web Search Link',
            type: 'web'
          });
        }
        if (chunk.maps) {
          sources.push({
            uri: (chunk.maps as any).uri || '', // Use any to avoid type check issues if uri isn't in definition
            title: (chunk.maps as any).title || 'Google Maps Location',
            type: 'maps'
          });
        }
      });

      result.sources = sources;
    }
    
    return result;
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    const detail =
      error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(
      `Could not analyze the image correctly. The AI responded but the result could not be parsed (${detail}). Try again, switch to Web Search grounding, or use a more capable analysis model in .env.local.`
    );
  }
}
