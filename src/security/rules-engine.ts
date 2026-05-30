import type { RiskItem, ChangedFile, FilteredDiff } from '../types/index.js';
import { RiskLevel } from '../types/index.js';
import { ALL_RULES, type SecurityRule } from './rules-registry.js';
import { minimatch } from 'minimatch';

export interface SecurityScanResult {
  risks: RiskItem[];
  /** Files that were fully scanned. */
  filesScanned: number;
  /** Rules that triggered at least one match. */
  rulesTriggered: string[];
}

export interface ScanOptions {
  /** Custom rules to include alongside the default set. */
  customRules?: SecurityRule[];
  /** When true, skip Warning-level rules (only Critical). */
  criticalOnly?: boolean;
  /** Maximum risks to return (prevents flooding). */
  maxRisks?: number;
}

const DEFAULT_MAX_RISKS = 25;

/**
 * Security scanning engine — matches code patches against a registry of
 * known-dangerous patterns (XSS, injection, secrets, path traversal, etc.).
 */
export class SecurityScanner {
  private rules: SecurityRule[];

  constructor(rules?: SecurityRule[]) {
    this.rules = rules ?? ALL_RULES;
  }

  /**
   * Scan a set of changed files for security risks.
   */
  scanFiles(files: ChangedFile[], options: ScanOptions = {}): SecurityScanResult {
    const activeRules = this.prepareRules(options);
    const maxRisks = options.maxRisks ?? DEFAULT_MAX_RISKS;
    const risks: RiskItem[] = [];
    const rulesTriggered = new Set<string>();
    let filesScanned = 0;

    for (const file of files) {
      if (file.isNoise || risks.length >= maxRisks) break;
      if (!file.patch || file.status === 'removed') continue;

      const lines = file.patch.split('\n');
      const addedLines = this.extractAddedLines(lines);
      filesScanned++;

      for (const rule of activeRules) {
        if (!this.ruleAppliesToFile(rule, file.filename)) continue;

        for (const { lineNo, content } of addedLines) {
          if (risks.length >= maxRisks) break;

          for (const pattern of rule.patterns) {
            if (pattern.test(content)) {
              // Avoid duplicate findings on same line
              const alreadyReported = risks.some(
                (r) => r.file === file.filename && r.line === lineNo && r.ruleRef === rule.id,
              );
              if (alreadyReported) continue;

              risks.push({
                level: rule.level,
                file: file.filename,
                line: lineNo,
                title: rule.title,
                description: rule.description,
                suggestion: rule.suggestion,
                confidence: 0.92,
                ruleRef: rule.id,
                isFalsePositiveLikely: false,
              });
              rulesTriggered.add(rule.id);
              break;
            }
          }
        }
      }
    }

    return { risks: risks.slice(0, maxRisks), filesScanned, rulesTriggered: [...rulesTriggered] };
  }

  /**
   * Scan a FilteredDiff (from the diff pipeline) for security risks.
   */
  scanDiff(diff: FilteredDiff, options: ScanOptions = {}): SecurityScanResult {
    const activeRules = this.prepareRules(options);
    const maxRisks = options.maxRisks ?? DEFAULT_MAX_RISKS;
    const risks: RiskItem[] = [];
    const rulesTriggered = new Set<string>();

    for (const patch of diff.businessPatches) {
      if (risks.length >= maxRisks) break;

      const lines = patch.patch.split('\n');
      const addedLines = this.extractAddedLines(lines);

      for (const rule of activeRules) {
        if (!this.ruleAppliesToFile(rule, patch.filename)) continue;

        for (const { lineNo, content } of addedLines) {
          if (risks.length >= maxRisks) break;

          for (const pattern of rule.patterns) {
            if (pattern.test(content)) {
              const alreadyReported = risks.some(
                (r) => r.file === patch.filename && r.line === lineNo && r.ruleRef === rule.id,
              );
              if (alreadyReported) continue;

              risks.push({
                level: rule.level,
                file: patch.filename,
                line: lineNo,
                title: rule.title,
                description: rule.description,
                suggestion: rule.suggestion,
                confidence: 0.92,
                ruleRef: rule.id,
                isFalsePositiveLikely: false,
              });
              rulesTriggered.add(rule.id);
              break;
            }
          }
        }
      }
    }

    return {
      risks: risks.slice(0, maxRisks),
      filesScanned: diff.businessPatches.length,
      rulesTriggered: [...rulesTriggered],
    };
  }

  /**
   * Merge security scan results with AI review results.
   * Security findings that overlap with AI-detected risks are deduplicated.
   */
  mergeWithAIReport(aiRisks: RiskItem[], securityRisks: RiskItem[]): RiskItem[] {
    const merged = [...aiRisks];

    for (const secRisk of securityRisks) {
      const overlap = aiRisks.some(
        (ai) =>
          ai.file === secRisk.file && ai.line === secRisk.line,
      );
      if (!overlap) {
        merged.push(secRisk);
      }
    }

    return merged;
  }

  // ---- internal ----

  private prepareRules(options: ScanOptions): SecurityRule[] {
    let rules = this.rules;
    if (options.customRules && options.customRules.length > 0) {
      rules = [...rules, ...options.customRules];
    }
    if (options.criticalOnly) {
      rules = rules.filter((r) => r.level === RiskLevel.Critical);
    }
    return rules;
  }

  private ruleAppliesToFile(rule: SecurityRule, filename: string): boolean {
    if (rule.fileGlobs.length === 0) return true;
    return rule.fileGlobs.some(
      (glob) => minimatch(filename, glob, { matchBase: true }),
    );
  }

  private extractAddedLines(
    lines: string[],
  ): Array<{ lineNo: number; content: string }> {
    const result: Array<{ lineNo: number; content: string }> = [];
    let currentLine = 0;

    for (const line of lines) {
      // Unified diff format: @@ -a,b +c,d @@ gives us the new-file line number
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10) - 1;
        continue;
      }
      if (line.startsWith('-') || line.startsWith('\\')) continue;
      if (line.startsWith('+')) {
        currentLine++;
        result.push({ lineNo: currentLine, content: line.slice(1) });
      } else {
        currentLine++;
      }
    }

    return result;
  }
}
