import type { AIProvider, AIChatMessage, ReviewReport, ReviewRequest } from '../types/index.js';
import { buildPrompt } from './prompt-builder.js';
import type { CustomReviewRule } from './prompt-builder.js';
import { parseReviewReport } from './output-parser.js';

type Log = Pick<typeof console, 'info' | 'warn' | 'error'>;

export interface AIEngineConfig {
  /** Primary model provider. */
  primary: AIProvider;
  /** Optional fallback provider (used when primary times out or fails). */
  fallback?: AIProvider;
}

/**
 * AI inference engine — orchestrates model calls with fallback,
 * parses the structured response, and logs token usage.
 */
export class AIEngine {
  private primary: AIProvider;
  private fallback?: AIProvider;

  constructor(config: AIEngineConfig) {
    this.primary = config.primary;
    this.fallback = config.fallback;
  }

  /**
   * Analyse a pull request and return a structured review report.
   */
  async analyze(
    request: ReviewRequest,
    customRules: CustomReviewRule[] = [],
    log: Log = console,
  ): Promise<ReviewReport> {
    const messages = buildPrompt(request, customRules);

    const result = await this.callWithFallback(messages, log);

    log.info(
      `[AI] model=${result.provider} tokens=${result.usage.totalTokens} latency=${result.latencyMs}ms`,
    );

    // Debug: log raw response for parser diagnostics
    log.info(`[AI] raw first 500 chars: ${result.raw.slice(0, 500)}`);
    log.info(`[AI] raw last 200 chars: ${result.raw.slice(-200)}`);

    return parseReviewReport(result.raw, request);
  }

  /**
   * Calls the primary provider; if it fails or times out, attempts the fallback.
   */
  private async callWithFallback(
    messages: AIChatMessage[],
    log: Log,
  ): Promise<{
    raw: string;
    usage: { totalTokens: number };
    latencyMs: number;
    provider: string;
  }> {
    try {
      const response = await this.primary.analyze(messages);
      return { ...response, provider: this.primary.name };
    } catch (err) {
      log.warn(`[AI] Primary provider (${this.primary.name}) failed: ${(err as Error).message}`);
      if (this.fallback) {
        log.info(`[AI] Falling back to ${this.fallback.name}`);
        try {
          const response = await this.fallback.analyze(messages);
          return { ...response, provider: this.fallback.name };
        } catch (fallbackErr) {
          throw new Error(
            `All AI providers failed. Primary: ${(err as Error).message}. Fallback: ${(fallbackErr as Error).message}`,
          );
        }
      }
      throw err;
    }
  }
}
