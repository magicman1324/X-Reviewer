/* eslint-disable no-unused-vars -- type definitions used by downstream modules */

/** Risk severity level for reviewed issues. */
export enum RiskLevel {
  /** Potential crash, security vuln, or data loss — must fix. */
  Critical = 'critical',
  /** Dead code, performance smell, or untested edge case — should fix. */
  Warning = 'warning',
}

/** What triggered the review. */
export enum TriggerSource {
  PR_Opened = 'pr_opened',
  PR_Synchronize = 'pr_synchronize',
  Manual_Review = 'manual_review',
  Manual_Deep = 'manual_deep',
}

/** Job status in the async review queue. */
export enum QueueJobStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

/**
 * A single file changed in the pull request (GitHub API shape).
 */
export interface ChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  patch?: string;
  additions: number;
  deletions: number;
  /** Set by the Diff pipeline — true when the file should be excluded from AI analysis. */
  isNoise: boolean;
}

/** A single file's processed diff. */
export interface FilePatch {
  filename: string;
  /** Cleaned business-code lines with +/- prefix and 3-line context. */
  patch: string;
  lines: number;
}

/** Output of the Diff purification pipeline. */
export interface FilteredDiff {
  /** Full diff string as returned by GitHub. */
  raw: string;
  /** Only non-noise file patches suitable for AI consumption. */
  businessPatches: FilePatch[];
  /** Files that were excluded (lock files, images, binaries, etc.). */
  noiseFiles: string[];
}

/** Captured context beyond the diff itself. */
export interface ReviewContext {
  linkedIssues: LinkedIssue[];
  language?: string;
  framework?: string;
  customRules?: string;
}

/** A referenced issue (e.g. from "fixes #123"). */
export interface LinkedIssue {
  number: number;
  title: string;
  body: string;
}

/** Assembled payload sent to the AI engine. */
export interface ReviewRequest {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  headSha: string;
  baseSha: string;
  files: ChangedFile[];
  diff: FilteredDiff;
  context: ReviewContext;
  trigger: TriggerSource;
  /** GitHub App installation ID for auth in async workers. */
  installationId?: number;
}

/** A single risk item in the review report. */
export interface RiskItem {
  level: RiskLevel;
  file: string;
  line: number;
  title: string;
  description: string;
  suggestion: string;
  fixCode?: string;
  /** 0.0–1.0 confidence score from the model. */
  confidence: number;
  /** Reference to a security rule, if detected by the patterns engine. */
  ruleRef?: string;
  /** Model's own assessment of whether this might be a false positive. */
  isFalsePositiveLikely: boolean;
}

/** Structured review report returned by the AI engine. */
export interface ReviewReport {
  summary: string;
  risks: RiskItem[];
  /** 0.0–10.0 overall code quality score. */
  overallScore: number;
  suggestedLabels: string[];
  analysedAt: string;
}

/** Job stored in the async review queue. */
export interface QueueJob {
  id: string;
  request: ReviewRequest;
  status: QueueJobStatus;
  /** GitHub comment ID used for the placeholder → report swap. */
  commentId: number;
  createdAt: Date;
  attempts: number;
  lastError?: string;
}

/** Chat message for LLM providers. */
export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Raw response from an AI provider. */
export interface AIChatResponse {
  raw: string;
  usage: AITokenUsage;
  latencyMs: number;
}

/** Token usage from the model API. */
export interface AITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * AI provider interface — every model adapter must implement this.
 * Allows swapping between deepseek-v4-pro, Claude, etc.
 */
export interface AIProvider {
  readonly name: string;
  analyze(messages: AIChatMessage[]): Promise<AIChatResponse>;
}

/** Server configuration built from environment variables. */
export interface AppConfig {
  appId: number;
  privateKey: string;
  secret: string;
  port: number;
  logLevel: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  redisUrl?: string;
}
