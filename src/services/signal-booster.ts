import type { RiskItem, ReviewReport } from '../types/index.js';
import { RiskLevel } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A risk item enriched with composite scoring and dedup/noise metadata. */
export interface BoostedRiskItem extends RiskItem {
  /** 0–100 unified risk score: severity × confidence × specificity. */
  compositeScore: number;
  /** Group ID when this risk belongs to a cluster of related alerts. */
  clusterId?: string;
  /** True when the booster has suppressed this alert as low-signal noise. */
  isNoise: boolean;
  /** Human-readable reason when isNoise === true. */
  noiseReason?: string;
  /** Index of the canonical risk this one duplicates (internal). */
  dupOf?: number;
}

/** A cluster of semantically related alerts (e.g. "SQL injection × 4 files"). */
export interface AlertCluster {
  id: string;
  /** Human-readable group label. */
  title: string;
  /** Indices into the boosted risks array. */
  riskIds: number[];
  /** Highest severity in the cluster. */
  severity: RiskLevel;
  /** Number of distinct files affected. */
  fileCount: number;
}

/** Quality metrics for the review's signal-to-noise characteristics. */
export interface SignalQuality {
  /** 0–1 where 1 means every alert is high-signal. */
  signalToNoiseRatio: number;
  /** Number of alerts suppressed as noise. */
  suppressedCount: number;
  /** Number of duplicate alerts merged. */
  duplicateCount: number;
  /** Number of alert clusters formed. */
  clusterCount: number;
  /** 0–1 overall trust score for the entire review. */
  overallTrust: number;
}

/** Full boosted report with clustering and quality metadata. */
export interface BoostedReport extends ReviewReport {
  risks: BoostedRiskItem[];
  clusters: AlertCluster[];
  signalQuality: SignalQuality;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class SignalBooster {
  private noiseThreshold: number;

  constructor(noiseThreshold = 25) {
    this.noiseThreshold = noiseThreshold;
  }

  /** Main entry point — boost a report through all stages. */
  boost(report: ReviewReport): BoostedReport {
    let risks: BoostedRiskItem[] = report.risks.map((r) => ({
      ...r,
      compositeScore: 0,
      isNoise: false,
    }));

    const dedupResult = this.deduplicate(risks);
    risks = dedupResult.risks;
    const dupCount = dedupResult.duplicatesFound;

    risks = this.rank(risks);
    const suppressResult = this.suppressNoise(risks);
    risks = suppressResult.risks;

    const clusters = this.cluster(risks);
    risks = this.assignClusters(risks, clusters);

    const signalQuality = this.calculateSignalQuality(risks, clusters, dupCount);

    return {
      ...report,
      risks,
      clusters,
      signalQuality,
    };
  }

  // ---- Deduplication ----

  /**
   * Merge near-duplicate alerts. Two alerts are duplicates when they share
   * a ruleRef OR have >= 70 % title word overlap AND are in the same file
   * within 10 lines of each other.
   */
  deduplicate(risks: BoostedRiskItem[]): { risks: BoostedRiskItem[]; duplicatesFound: number } {
    const result: BoostedRiskItem[] = [];
    let duplicatesFound = 0;

    for (const risk of risks) {
      const dupIdx = result.findIndex((existing) => this.areDuplicates(existing, risk));
      if (dupIdx >= 0) {
        duplicatesFound++;
        const canonical = result[dupIdx];
        // Merge: keep the higher-confidence version, append line info
        if (risk.confidence > canonical.confidence) {
          result[dupIdx] = { ...risk, compositeScore: canonical.compositeScore, isNoise: canonical.isNoise };
        }
        result[dupIdx].dupOf = dupIdx;
        if (!result[dupIdx].description.includes(risk.file)) {
          result[dupIdx].description += ` (also in ${risk.file}:${risk.line})`;
        }
      } else {
        result.push(risk);
      }
    }

    return { risks: result, duplicatesFound };
  }

  private areDuplicates(a: RiskItem, b: RiskItem): boolean {
    // Same security rule match
    if (a.ruleRef && b.ruleRef && a.ruleRef === b.ruleRef && a.file === b.file) return true;

    // Same file + close lines + similar title
    if (a.file === b.file && Math.abs(a.line - b.line) <= 10) {
      const overlap = this.titleWordOverlap(a.title, b.title);
      if (overlap >= 0.6) return true;
    }

    // Same ruleRef across different files (same vulnerability pattern)
    if (a.ruleRef && a.ruleRef === b.ruleRef && this.titleWordOverlap(a.title, b.title) >= 0.5) {
      return true;
    }

    return false;
  }

  private titleWordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    return intersection / Math.max(wordsA.size, wordsB.size);
  }

  // ---- Smart Ranking ----

  /**
   * Calculate a composite 0–100 score for each risk:
   *   severity (40%) + confidence (45%) + specificity (15%)
   */
  rank(risks: BoostedRiskItem[]): BoostedRiskItem[] {
    return risks.map((r) => {
      const severityScore = r.level === RiskLevel.Critical ? 100 : 55;
      const confidenceScore = r.confidence * 100;
      const specificity = clamp(r.title.length / 60, 0, 1) * 100;
      const composite = severityScore * 0.4 + confidenceScore * 0.45 + specificity * 0.15;
      return { ...r, compositeScore: Math.round(composite) };
    });
  }

  // ---- Noise Suppression ----

  /**
   * Suppress risks whose composite score falls below the noise threshold.
   * Each suppressed risk gets a human-readable reason for transparency.
   */
  suppressNoise(risks: BoostedRiskItem[]): { risks: BoostedRiskItem[]; suppressed: number } {
    let suppressed = 0;

    const processed = risks.map((r) => {
      if (r.isNoise) return r; // already suppressed

      if (r.compositeScore < this.noiseThreshold) {
        suppressed++;
        return {
          ...r,
          isNoise: true,
          noiseReason: this.buildNoiseReason(r),
        };
      }

      // Also suppress if confidence below 0.2 regardless of score
      if (r.confidence < 0.2 && r.level !== RiskLevel.Critical) {
        suppressed++;
        return {
          ...r,
          isNoise: true,
          noiseReason: `Very low model confidence (${(r.confidence * 100).toFixed(0)}%)${r.isFalsePositiveLikely ? ' + flagged as likely false positive' : ''} — likely a false alarm.`,
        };
      }

      return r;
    });

    return { risks: processed, suppressed };
  }

  private buildNoiseReason(r: RiskItem): string {
    const parts: string[] = [];
    if (r.confidence < 0.4) parts.push(`low confidence (${(r.confidence * 100).toFixed(0)}%)`);
    if (r.title.length < 15) parts.push('vague title');
    if (r.isFalsePositiveLikely) parts.push('flagged as likely false positive');
    if (r.level === RiskLevel.Warning) parts.push('warning-level severity');
    return parts.length > 0 ? `Suppressed: ${parts.join(' + ')}.` : 'Suppressed: composite score below noise threshold.';
  }

  // ---- Clustering ----

  /**
   * Group risks into semantically related clusters.
   * Clustering key: ruleRef → keyword pattern → file prefix.
   */
  cluster(risks: BoostedRiskItem[]): AlertCluster[] {
    const active = risks.filter((r) => !r.isNoise);
    const clusters: AlertCluster[] = [];
    const assigned = new Set<number>();

    // Cluster by ruleRef
    const byRule = new Map<string, number[]>();
    for (let i = 0; i < active.length; i++) {
      if (active[i].ruleRef) {
        const key = `rule:${active[i].ruleRef}`;
        if (!byRule.has(key)) byRule.set(key, []);
        byRule.get(key)!.push(i);
      }
    }
    for (const [key, indices] of byRule) {
      if (indices.length >= 2) {
        const ruleRef = key.slice(5);
        clusters.push(this.buildCluster(active, indices, ruleRef, `cluster_rule_${ruleRef}`));
        indices.forEach((i) => assigned.add(i));
      }
    }

    // Cluster remaining by keyword patterns
    const byKeyword = new Map<string, number[]>();
    for (let i = 0; i < active.length; i++) {
      if (assigned.has(i)) continue;
      const kw = this.extractKeyword(active[i].title);
      if (kw) {
        if (!byKeyword.has(kw)) byKeyword.set(kw, []);
        byKeyword.get(kw)!.push(i);
      }
    }
    for (const [kw, indices] of byKeyword) {
      if (indices.length >= 2) {
        clusters.push(this.buildCluster(active, indices, kw, `cluster_kw_${kw.replace(/\s+/g, '_')}`));
        indices.forEach((i) => assigned.add(i));
      }
    }

    // Solo risks get their own single-item cluster
    for (let i = 0; i < active.length; i++) {
      if (!assigned.has(i)) {
        clusters.push(this.buildCluster(active, [i], active[i].title, `cluster_solo_${i}`));
      }
    }

    return clusters;
  }

  private buildCluster(
    risks: BoostedRiskItem[],
    indices: number[],
    title: string,
    id: string,
  ): AlertCluster {
    const files = new Set(indices.map((i) => risks[i].file));
    const maxSeverity = indices.some((i) => risks[i].level === RiskLevel.Critical)
      ? RiskLevel.Critical
      : RiskLevel.Warning;

    return {
      id,
      title: title.length > 60 ? title.slice(0, 57) + '...' : title,
      riskIds: indices,
      severity: maxSeverity,
      fileCount: files.size,
    };
  }

  private extractKeyword(title: string): string | null {
    const patterns: [RegExp, string][] = [
      [/sql\s*(injection|query)/i, 'SQL injection'],
      [/xss|cross[-\s]?site\s*scripting/i, 'Cross-site scripting (XSS)'],
      [/command\s*(injection|exec)/i, 'Command injection'],
      [/hard[-\s]?cod(ed|ing)/i, 'Hardcoded value'],
      [/race\s*condition/i, 'Race condition'],
      [/weak\s*(crypto|hash|algorithm|encrypt)/i, 'Weak cryptography'],
      [/auth(entication|orization)?\s*(bypass|missing|weak)/i, 'Authentication issue'],
      [/path\s*traversal/i, 'Path traversal'],
      [/ssrf/i, 'SSRF'],
      [/secret|api[-\s]?key|token|password|credential/i, 'Exposed secret'],
      [/null\s*(pointer|reference|check|dereference)/i, 'Null safety'],
      [/unsafe|unvalidated\s*input/i, 'Unvalidated input'],
    ];

    for (const [re, label] of patterns) {
      if (re.test(title)) return label;
    }
    return null;
  }

  private assignClusters(risks: BoostedRiskItem[], clusters: AlertCluster[]): BoostedRiskItem[] {
    const idxToCluster = new Map<number, string>();
    for (const c of clusters) {
      for (const idx of c.riskIds) {
        idxToCluster.set(idx, c.id);
      }
    }
    return risks.map((r, i) => {
      const cid = idxToCluster.get(i);
      return cid ? { ...r, clusterId: cid } : r;
    });
  }

  // ---- Signal Quality ----

  calculateSignalQuality(
    risks: BoostedRiskItem[],
    clusters: AlertCluster[],
    duplicateCount: number,
  ): SignalQuality {
    const active = risks.filter((r) => !r.isNoise);
    const suppressed = risks.filter((r) => r.isNoise);
    const total = risks.length;

    const signalToNoiseRatio = total > 0 ? active.length / total : 1;

    // Trust = average of: SNR, high-confidence ratio, and specificity ratio
    const highConfRatio = active.length > 0
      ? active.filter((r) => r.confidence >= 0.6).length / active.length
      : 0;
    const specificRatio = active.length > 0
      ? active.filter((r) => r.title.length >= 20).length / active.length
      : 0;
    const overallTrust = clamp((signalToNoiseRatio * 0.4 + highConfRatio * 0.35 + specificRatio * 0.25), 0, 1);

    return {
      signalToNoiseRatio: Math.round(signalToNoiseRatio * 100) / 100,
      suppressedCount: suppressed.length,
      duplicateCount,
      clusterCount: clusters.length,
      overallTrust: Math.round(overallTrust * 100) / 100,
    };
  }
}
