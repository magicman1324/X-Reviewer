import type { AIProvider, AIChatMessage, ReviewReport, ReviewRequest } from '../types/index.js';
import { buildPrompt } from './prompt-builder.js';
import type { CustomReviewRule } from './prompt-builder.js';

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

    return parseReviewReport(result.raw, request);
  }

  /**
   * Calls the primary provider; if it fails or times out, attempts the fallback.
   */
  private async callWithFallback(
    messages: AIChatMessage[],
    log: Log,
  ): Promise<{ raw: string; usage: { totalTokens: number }; latencyMs: number; provider: string }> {
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

/**
 * Parse the raw model response into a structured ReviewReport.
 * Handles markdown-wrapped JSON, bare JSON, and falls back
 * to a degraded plain-text report on parse failure.
 */
export function parseReviewReport(raw: string, request: ReviewRequest): ReviewReport {
  // Strip markdown code fences if present
  let json = raw.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    json = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(json);

    // Coerce and validate
    const risks = (Array.isArray(parsed.risks) ? parsed.risks : []).map(
      (r: Record<string, unknown>) => ({
        level: r.level === 'critical' || r.level === 'warning' ? r.level : 'warning',
        file: String(r.file ?? ''),
        line: Math.max(0, safeNumber(r.line, 0)),
        title: String(r.title ?? ''),
        description: String(r.description ?? ''),
        suggestion: String(r.suggestion ?? ''),
        fixCode: r.fixCode ? String(r.fixCode) : undefined,
        confidence: clamp(safeNumber(r.confidence, 0.5), 0, 1),
        ruleRef: r.ruleRef ? String(r.ruleRef) : undefined,
        isFalsePositiveLikely: Boolean(r.isFalsePositiveLikely),
      }),
    );

    return {
      summary: String(parsed.summary ?? `Review of PR #${request.prNumber}`),
      risks,
      overallScore: clamp(safeNumber(parsed.overallScore, 5), 0, 10),
      suggestedLabels: Array.isArray(parsed.suggestedLabels)
        ? parsed.suggestedLabels.map(String)
        : [],
      analysedAt: new Date().toISOString(),
    };
  } catch {
    // Fallback: degrade to a plain-text summary
    return {
      summary: `AI analysis completed for PR #${request.prNumber}. Raw response could not be parsed as JSON.`,
      risks: [],
      overallScore: 0,
      suggestedLabels: ['ai-parse-failed'],
      analysedAt: new Date().toISOString(),
    };
  }
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
