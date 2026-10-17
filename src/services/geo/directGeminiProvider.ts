import { GoogleGenAI, type GenerateContentResponse, type GroundingMetadata } from '@google/genai';
import { DEFAULT_MODEL, getConfig, hasValidKeyChars, isKnownModel, type LocusConfig } from '../config';
import { LocusError, mapGeminiError } from './errors';
import { extractGrounding } from './grounding';
import { buildChatSystemInstruction, buildGeolocationPrompt } from './prompt';
import { parseModelGeolocation } from './schema';
import type {
  AnalyzeImageInput,
  ChatSession,
  GeolocationResult,
  GeoProvider,
  ImageInput,
} from './types';

const MAX_PARSE_ATTEMPTS = 2;

type ProviderConfig = Pick<LocusConfig, 'apiKey' | 'modelName'>;

/** What runAnalysis needs from a (possibly streamed) model answer. */
interface CollectedAnswer {
  text: string;
  finishReason?: string;
  groundingMetadata?: GroundingMetadata;
}

/**
 * Joins streamed chunks into one answer. Thought summaries are skipped: they are only
 * requested so that bytes keep flowing while the model thinks and searches.
 */
export function collectAnswer(chunks: GenerateContentResponse[]): CollectedAnswer {
  let text = '';
  let finishReason: string | undefined;
  let groundingMetadata: GroundingMetadata | undefined;
  for (const chunk of chunks) {
    const candidate = chunk.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (parts) {
      for (const part of parts) if (!part.thought && part.text) text += part.text;
    } else if (chunk.text) {
      text += chunk.text;
    }
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (candidate?.groundingMetadata) groundingMetadata = candidate.groundingMetadata;
  }
  return { text, finishReason, groundingMetadata };
}

/**
 * Free tier (ADR-001): the browser calls Gemini directly with the user's own key.
 * Images never pass through Provereno infrastructure.
 */
export class DirectGeminiProvider implements GeoProvider {
  readonly id = 'direct-gemini';

  private client: GoogleGenAI | null = null;
  private clientKey: string | null = null;

  constructor(private readonly readConfig: () => ProviderConfig = getConfig) {}

  async analyzeImage(input: AnalyzeImageInput): Promise<GeolocationResult> {
    const { apiKey, modelName } = this.requireConfig();
    try {
      return await this.runAnalysis(apiKey, modelName, input);
    } catch (error) {
      if (
        error instanceof LocusError &&
        (error.code === 'MODEL_UNAVAILABLE' || error.code === 'MODEL_RETIRED') &&
        modelName !== DEFAULT_MODEL
      ) {
        try {
          const result = await this.runAnalysis(apiKey, DEFAULT_MODEL, input);
          return { ...result, modelFallbackFrom: modelName };
        } catch (fallbackError) {
          throw await this.explainQuota(apiKey, DEFAULT_MODEL, fallbackError);
        }
      }
      throw await this.explainQuota(apiKey, modelName, error);
    }
  }

  /**
   * Some keys (seen with free-tier keys) get 429 only for requests with Search/Maps
   * grounding, while plain requests pass. One plain request tells the two cases apart.
   */
  private async explainQuota(apiKey: string, model: string, error: unknown): Promise<unknown> {
    if (!(error instanceof LocusError) || error.code !== 'QUOTA') return error;
    try {
      await this.getClient(apiKey).models.generateContent({ model, contents: 'ping' });
    } catch {
      return error;
    }
    return new LocusError('GROUNDING_QUOTA', error.detail);
  }

  createChatSession(image: ImageInput, result: GeolocationResult): ChatSession {
    const { apiKey, modelName } = this.requireConfig();
    // Results from old history may name a model that is unknown or withdrawn.
    const chat = this.getClient(apiKey).chats.create({
      model: isKnownModel(result.model) ? result.model : modelName,
      config: {
        systemInstruction: buildChatSystemInstruction(result),
        temperature: 0.3,
      },
    });

    let imageSent = false;

    return {
      async sendMessage(text: string): Promise<string> {
        try {
          const response = imageSent
            ? await chat.sendMessage({ message: text })
            : await chat.sendMessage({
                message: [{ inlineData: { data: image.base64Data, mimeType: image.mimeType } }, { text }],
              });
          imageSent = true;
          return response.text ?? '';
        } catch (error) {
          console.error('Gemini chat request failed', error);
          throw mapGeminiError(error);
        }
      },
    };
  }

  private requireConfig(): ProviderConfig {
    const config = this.readConfig();
    if (!config.apiKey) throw new LocusError('NO_KEY');
    if (!hasValidKeyChars(config.apiKey)) throw new LocusError('BAD_KEY');
    return config;
  }

  private getClient(apiKey: string): GoogleGenAI {
    if (!this.client || this.clientKey !== apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      this.clientKey = apiKey;
    }
    return this.client;
  }

  private async runAnalysis(
    apiKey: string,
    model: string,
    input: AnalyzeImageInput,
  ): Promise<GeolocationResult> {
    let lastError = '';

    for (let attempt = 0; attempt < MAX_PARSE_ATTEMPTS; attempt++) {
      const { text, finishReason, groundingMetadata } = await this.generate(apiKey, model, input);

      if (!text.trim()) {
        throw new LocusError('BLOCKED', `finishReason=${finishReason ?? 'none'}`);
      }

      const parsed = parseModelGeolocation(text);
      if (parsed.ok) {
        const grounding = extractGrounding(groundingMetadata);
        const { searchQueriesExecuted, ...data } = parsed.data;
        return {
          ...data,
          modelReportedQueries: searchQueriesExecuted,
          groundingQueries: grounding.groundingQueries,
          sources: grounding.sources,
          searchEntryPointHtml: grounding.searchEntryPointHtml,
          model,
          mode: input.mode,
          groundingTool: input.groundingTool,
          analyzedAt: new Date().toISOString(),
        };
      }
      lastError = parsed.error;
      console.warn(`Geolocation response could not be parsed (attempt ${attempt + 1})`, parsed.error);
    }

    throw new LocusError('PARSE', lastError);
  }

  private async generate(
    apiKey: string,
    model: string,
    input: AnalyzeImageInput,
  ): Promise<CollectedAnswer> {
    // Streamed so that data keeps flowing during long grounded requests: proxies that
    // close idle connections otherwise drop the answer after Google has processed (and
    // billed) the request.
    const startedAt = Date.now();
    try {
      const stream = await this.getClient(apiKey).models.generateContentStream({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { data: input.base64Data, mimeType: input.mimeType } },
              { text: buildGeolocationPrompt(input.mode, input.groundingTool) },
            ],
          },
        ],
        config: {
          // A3: JSON mode (responseMimeType) together with Google Maps grounding is not
          // documented as supported. We rely on the prompt plus tolerant parsing and
          // schema validation instead. Re-evaluate after a live test with a real key.
          tools: [input.groundingTool === 'maps' ? { googleMaps: {} } : { googleSearch: {} }],
          thinkingConfig: { includeThoughts: true },
        },
      });
      const chunks: GenerateContentResponse[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return collectAnswer(chunks);
    } catch (error) {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      console.error(`Gemini request failed after ${seconds} s`, error);
      const mapped = mapGeminiError(error);
      if (mapped.code === 'NETWORK') {
        throw new LocusError('NETWORK', `connection closed after ${seconds} s; the request may still have been processed and billed`);
      }
      throw mapped;
    }
  }
}
