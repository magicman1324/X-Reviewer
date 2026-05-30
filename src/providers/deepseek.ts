import type { AIProvider, AIChatMessage, AIChatResponse, AITokenUsage } from '../types/index.js';

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Max wait for first token in ms. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * DeepSeek V4 Pro provider — OpenAI-compatible API.
 *
 * Uses native fetch (Node 18+) and AbortController for timeout.
 * Supports the /chat/completions endpoint with structured JSON output.
 */
export class DeepSeekProvider implements AIProvider {
  readonly name = 'deepseek-v4-pro';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.model = config.model || DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async analyze(messages: AIChatMessage[]): Promise<AIChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.1,
          max_tokens: 4096,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `DeepSeek API error ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`,
        );
      }

      const data = (await response.json()) as DeepSeekChatResponse;
      const latencyMs = Date.now() - startTime;

      const usage: AITokenUsage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      };

      const raw = data.choices?.[0]?.message?.content ?? '';

      return { raw, usage, latencyMs };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`DeepSeek API timeout after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Shape of DeepSeek chat completion response. */
interface DeepSeekChatResponse {
  id?: string;
  choices?: {
    index?: number;
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
