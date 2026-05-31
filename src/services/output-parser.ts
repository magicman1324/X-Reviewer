import { RiskLevel } from '../types/index.js';
import type { ReviewReport, RiskItem } from '../types/index.js';

/**
 * Structured output parser with three-tier fallback:
 *
 *   Tier 1 – Direct JSON parse (handles bare JSON and markdown-fenced)
 *   Tier 2 – Regex extraction from unstructured text
 *   Tier 3 – Empty report as last resort (never throws)
 */

// ---- Tier 1: JSON extraction ----

/**
 * Strip common AI model wrappers that aren't JSON:
 * - Markdown code fences (```json ... ```)
 * - 思考/thinking/reasoning tags from DeepSeek R1-style models
 */
function stripAiWrappers(text: string): string {
  let t = text.trim();

  // Remove markdown code fences
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    t = fenceMatch[1].trim();
  }

  // Remove 思考/thinking blocks (DeepSeek R1 reasoning)
  t = t.replace(/<思考>[\s\S]*?<\/思考>/g, '');
  t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  t = t.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

  return t.trim();
}

/**
 * Extract a self-contained JSON object from `text` starting at `startPos`,
 * correctly skipping braces inside strings. Returns the JSON slice or null.
 */
function extractJsonAt(text: string, startPos: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) {
      return text.slice(startPos, i + 1);
    }
  }

  return null;
}

/** Fields we expect in the review JSON — used to pick the best candidate. */
const REVIEW_FIELDS = ['summary', 'risks', 'overallScore'];

function isReviewJson(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj as object);
  return REVIEW_FIELDS.every((f) => keys.includes(f));
}

function extractJson(raw: string): string | null {
  const text = stripAiWrappers(raw);
  if (!text.length) return null;

  // Collect all JSON-object candidates
  const candidates: string[] = [];
  let pos = 0;
  while ((pos = text.indexOf('{', pos)) !== -1) {
    const candidate = extractJsonAt(text, pos);
    if (candidate) {
      candidates.push(candidate);
      pos += candidate.length;
    } else {
      pos++;
    }
  }

  if (candidates.length === 0) return null;

  // If the first candidate looks like a review report, use it
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (isReviewJson(parsed)) return c;
    } catch {
      // try next
    }
  }

  // Fallback: return the largest JSON-looking candidate
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].length > best.length) best = candidates[i];
  }
  return best;
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

// ---- Tier 2: Regex fallback ----

const RE_SUMMARY = /(?:summary|总结|摘要)[：:]\s*(.+?)(?:\n|$)/i;

const RE_RISK_BLOCK =
  /(?:风险|risk|issue)\s*\d*[：:]\s*\[(critical|warning|高危|警告)\]\s*([^\s:]+)[：:]\s*(\d+)\s*[-–—]\s*(.+?)(?=\n\n|\n\s*(?:风险|risk|issue|suggestion|建议|score|评分|$))/gis;

const RE_SUGGESTION =
  /(?:建议|suggestion|fix)[：:]\s*(.+?)(?=\n\n|\n\s*(?:风险|risk|issue|建议|suggestion|score|评分|$))/is;

const RE_SCORE = /(?:score|评分|overall.?score)[：:]\s*(\d+(?:\.\d+)?)/i;

function regexFallback(raw: string, prNumber: number): ReviewReport {
  const summaryMatch = RE_SUMMARY.exec(raw);
  const summary = summaryMatch?.[1]?.trim() ?? `AI review of PR #${prNumber}`;

  // Collect risks via regex blocks
  const risks: RiskItem[] = [];
  const riskMatches = raw.matchAll(RE_RISK_BLOCK);
  for (const m of riskMatches) {
    const levelStr = m[1].toLowerCase();
    const level: RiskLevel =
      levelStr === 'critical' || levelStr === '高危' ? RiskLevel.Critical : RiskLevel.Warning;

    risks.push({
      level,
      file: m[2]?.trim() ?? '',
      line: Math.max(0, safeNumber(m[3], 0)),
      title: m[4]?.trim() ?? 'Unnamed risk',
      description: m[4]?.trim() ?? '',
      suggestion: '',
      confidence: 0.6,
      isFalsePositiveLikely: false,
    });
  }

  // Try to extract a fix suggestion
  const sugMatch = RE_SUGGESTION.exec(raw);
  if (sugMatch?.[1] && risks.length > 0) {
    risks[0].suggestion = sugMatch[1].trim();
  }

  // Extract score
  const scoreMatch = RE_SCORE.exec(raw);
  const overallScore = clamp(safeNumber(scoreMatch?.[1], 5), 0, 10);

  return {
    summary,
    risks,
    overallScore,
    suggestedLabels: risks.length > 0 ? ['ai-reviewed', 'needs-attention'] : ['ai-reviewed'],
    analysedAt: new Date().toISOString(),
  };
}

// ---- Tier 3: Empty report ----

function emptyReport(prNumber: number): ReviewReport {
  return {
    summary: `AI analysis completed for PR #${prNumber}. Could not extract structured report from model response.`,
    risks: [],
    overallScore: 0,
    suggestedLabels: ['ai-parse-failed'],
    analysedAt: new Date().toISOString(),
  };
}

// ---- Main parse function ----

/**
 * Parse model output into a structured ReviewReport.
 * Three-tier strategy: JSON → regex fallback → empty report.
 * Never throws.
 */
export function parseReviewReport(raw: string, request: { prNumber: number }): ReviewReport {
  // Tier 1 — try JSON
  const json = extractJson(raw);
  if (json) {
    try {
      const parsed = JSON.parse(json);
      const risks = (Array.isArray(parsed.risks) ? parsed.risks : []).map(
        (r: Record<string, unknown>) => ({
          level: r.level === 'critical' ? RiskLevel.Critical : RiskLevel.Warning,
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
      // Fall through to Tier 2
    }
  }

  // Tier 2 — regex fallback
  const regexReport = regexFallback(raw, request.prNumber);
  if (
    regexReport.risks.length > 0 ||
    regexReport.summary !== `AI review of PR #${request.prNumber}`
  ) {
    return regexReport;
  }

  // Tier 3 — empty report
  return emptyReport(request.prNumber);
}
