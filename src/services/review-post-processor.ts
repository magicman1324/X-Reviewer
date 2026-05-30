import type { RiskItem, ReviewReport } from '../types/index.js';
import { RiskLevel } from '../types/index.js';

export interface FPOptions {
  /** Risks with confidence below this threshold are flagged as likely FP. */
  lowConfidenceThreshold?: number;
  /** Risks with confidence above this threshold bypass all checks. */
  highConfidenceThreshold?: number;
  /** When true, remove risks flagged as false positives from the report. */
  autoRemove?: boolean;
  /** When true, downgrade (not remove) Critical → Warning for uncertain findings. */
  downgradeUncertain?: boolean;
}

const DEFAULT_OPTIONS: Required<FPOptions> = {
  lowConfidenceThreshold: 0.35,
  highConfidenceThreshold: 0.92,
  autoRemove: false,
  downgradeUncertain: true,
};

/**
 * Post-processing engine that reduces false positives and boosts confidence
 * on corroborated findings. Runs after AI review and security scanning.
 */
export class ReviewPostProcessor {
  private options: Required<FPOptions>;

  constructor(options: FPOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Process a full ReviewReport:
   * 1. Mark likely false positives
   * 2. Adjust confidence based on heuristics
   * 3. Optionally downgrade or remove low-confidence risks
   * 4. Recalculate overall score
   */
  process(report: ReviewReport): ReviewReport {
    let risks = this.detectFalsePositives(report.risks);
    risks = this.adjustConfidence(risks);
    risks = this.applyFilters(risks);

    if (risks.length !== report.risks.length || this.hasConfidenceChanged(report.risks, risks)) {
      report = {
        ...report,
        risks,
        overallScore: this.recalculateScore(risks, report.overallScore),
      };
    }

    return report;
  }

  /**
   * Detect likely false positives using heuristic rules.
   */
  detectFalsePositives(risks: RiskItem[]): RiskItem[] {
    return risks.map((risk) => {
      let fpScore = 0;

      // Heuristic 1: Very low AI confidence
      if (risk.confidence < this.options.lowConfidenceThreshold) {
        fpScore += 3;
      }

      // Heuristic 2: Vague/generic title patterns
      if (this.isVagueTitle(risk.title)) {
        fpScore += 2;
      }

      // Heuristic 3: Risk in test files is often intentional
      if (this.isTestFile(risk.file)) {
        fpScore += 2;
      }

      // Heuristic 4: Risk in config/definition files where patterns differ
      if (this.isConfigFile(risk.file) && risk.level === RiskLevel.Warning) {
        fpScore += 2;
      }

      // Heuristic 5: Very short title with low confidence = likely noise
      if (risk.title.length < 15 && risk.confidence < 0.5) {
        fpScore += 2;
      }

      // FP if score >= 2
      const updated = { ...risk };
      if (fpScore >= 2 && !risk.isFalsePositiveLikely) {
        updated.isFalsePositiveLikely = true;
      }
      // Attach FP score for diagnostics
      (updated as Record<string, unknown>)._fpScore = fpScore;

      return updated;
    });
  }

  /**
   * Adjust confidence scores based on corroborating signals.
   */
  adjustConfidence(risks: RiskItem[]): RiskItem[] {
    return risks.map((risk) => {
      let adjustment = 0;

      // Boost: Security rule match confirms the finding
      if (risk.ruleRef) {
        adjustment += 0.08;
      }

      // Boost: High-confidence AI finding with specific title
      if (risk.confidence >= 0.85 && risk.title.length > 20) {
        adjustment += 0.03;
      }

      // Penalty: Very short title (likely incomplete analysis)
      if (risk.title.length < 10) {
        adjustment -= 0.05;
      }

      // Penalty: Risk in node_modules or vendor path
      if (risk.file.includes('node_modules') || risk.file.includes('vendor/')) {
        adjustment -= 0.4;
      }

      // Penalty: risk in generated file
      if (risk.file.endsWith('.generated.ts') || risk.file.endsWith('.gen.ts')) {
        adjustment -= 0.3;
      }

      if (adjustment === 0) return risk;

      return {
        ...risk,
        confidence: clamp(risk.confidence + adjustment, 0, 1),
      };
    });
  }

  /**
   * Cross-validate AI risks against security scanner results.
   * Risks that match security rules get a confidence boost and ruleRef.
   */
  crossValidate(aiRisks: RiskItem[], securityRisks: RiskItem[]): RiskItem[] {
    return aiRisks.map((aiRisk) => {
      const match = securityRisks.find(
        (sec) =>
          sec.file === aiRisk.file &&
          sec.line === aiRisk.line,
      );
      if (match) {
        return {
          ...aiRisk,
          confidence: clamp(aiRisk.confidence + 0.1, 0, 1),
          ruleRef: aiRisk.ruleRef ?? match.ruleRef,
          isFalsePositiveLikely: false,
        };
      }
      return aiRisk;
    });
  }

  /**
   * Detect gap: security scanner found issues that AI missed entirely.
   * Returns the unmatched security risks as "missed" items (false negatives).
   */
  detectMissedRisks(aiRisks: RiskItem[], securityRisks: RiskItem[]): RiskItem[] {
    return securityRisks.filter(
      (sec) =>
        !aiRisks.some((ai) => ai.file === sec.file && ai.line === sec.line),
    );
  }

  // ---- internal ----

  private applyFilters(risks: RiskItem[]): RiskItem[] {
    return risks
      .filter((risk) => {
        if (this.options.autoRemove && risk.isFalsePositiveLikely) return false;
        return true;
      })
      .map((risk) => {
        if (this.options.downgradeUncertain && risk.isFalsePositiveLikely && risk.level === RiskLevel.Critical) {
          return { ...risk, level: RiskLevel.Warning };
        }
        return risk;
      });
  }

  private hasConfidenceChanged(original: RiskItem[], processed: RiskItem[]): boolean {
    if (original.length !== processed.length) return true;
    for (let i = 0; i < original.length; i++) {
      if (original[i].confidence !== processed[i].confidence) return true;
      if (original[i].isFalsePositiveLikely !== processed[i].isFalsePositiveLikely) return true;
    }
    return false;
  }

  private recalculateScore(risks: RiskItem[], currentScore: number): number {
    if (risks.length === 0) return Math.max(currentScore, 9);
    const criticalCount = risks.filter((r) => r.level === RiskLevel.Critical).length;
    const fpCount = risks.filter((r) => r.isFalsePositiveLikely).length;
    const total = risks.length;

    let score = 10 - criticalCount * 1.5 - (total - criticalCount) * 0.4;
    score += fpCount * 0.3;
    return clamp(score, 0, 10);
  }

  private isVagueTitle(title: string): boolean {
    const vaguePatterns = [
      /^(fix|improve|update|change|refactor|clean up|optimize)\b/i,
      /^(possible|potential|maybe|might be|may be)\b/i,
      /^(this (code|line|function) (is|may|might|could|should))/i,
    ];
    return vaguePatterns.some((re) => re.test(title));
  }

  private isTestFile(filename: string): boolean {
    return (
      filename.includes('.test.') ||
      filename.includes('.spec.') ||
      filename.includes('__tests__') ||
      filename.startsWith('test/') ||
      filename.startsWith('tests/') ||
      filename.startsWith('spec/')
    );
  }

  private isConfigFile(filename: string): boolean {
    const configPatterns = [
      /\.config\.(ts|js|json)$/,
      /\.eslintrc/,
      /\.prettierrc/,
      /tsconfig\.json$/,
      /webpack\.config/,
      /vite\.config/,
      /jest\.config/,
    ];
    return configPatterns.some((re) => re.test(filename));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
