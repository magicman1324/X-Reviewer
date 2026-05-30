import type { ReviewContext, ReviewRequest, TriggerSource } from '../types/index.js';
import { runDiffPipeline } from './diff-pipeline.js';
import type { GitHubClient } from '../utils/github-client.js';

/** Overall token budget for the AI prompt (code + context). */
const MAX_TOKENS = 64_000;

/** Tokens reserved for prompt scaffolding — the rest is available for context. */
const PROMPT_OVERHEAD_TOKENS = 8_000;

interface ContextBuilderOptions {
  client: GitHubClient;
  prNumber: number;
  trigger: TriggerSource;
  /** Override the default max token budget. */
  maxTokens?: number;
}

/**
 * Assembles a ReviewRequest by collecting context in four tiers:
 *
 *   L0 — PR title, body, changed files, cleaned diff
 *   L1 — Linked issues (extracted from body keywords)
 *   L2 — Full source of key changed files (within token budget)
 *   L3 — Project language / framework detection
 *
 * Each tier is optional — if one fails the builder continues
 * with whatever context has been collected so far.
 */
export async function buildContext(opts: ContextBuilderOptions): Promise<ReviewRequest> {
  const { client, prNumber, trigger, maxTokens = MAX_TOKENS - PROMPT_OVERHEAD_TOKENS } = opts;

  // ---- L0: PR metadata + file list ----
  const [pr, files] = await Promise.all([client.getPR(prNumber), client.getPRFiles(prNumber)]);

  const diff = runDiffPipeline(files, maxTokens);

  const context: ReviewContext = { linkedIssues: [] };

  // ---- L1: Linked issues ----
  if (pr.body) {
    try {
      context.linkedIssues = await client.getLinkedIssues(pr.body);
    } catch {
      // Non-blocking — continue without issue context
    }
  }

  // ---- L2: Full file content (key files only) ----
  const l2Overhead = estimateTokens(diff.raw);
  let remainingBudget = maxTokens - l2Overhead;

  // Sort business patches by importance (fewer lines = more likely to be key logic)
  const keyFiles = diff.businessPatches
    .slice(0, 10)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 5);

  for (const file of keyFiles) {
    if (remainingBudget <= 0) break;
    try {
      const content = await client.getFileContent(file.filename, pr.head.sha);
      if (content !== null) {
        const tokens = estimateTokens(content);
        if (tokens < remainingBudget) {
          remainingBudget -= tokens;
        }
      }
    } catch {
      // Continue without this file's full content
    }
  }

  // ---- L3: Project language / framework detection ----
  try {
    const meta = await client.getProjectMetadata(pr.head.sha);
    if (meta['package.json']) {
      const pkg = JSON.parse(meta['package.json']);
      context.language = 'TypeScript/JavaScript';
      context.framework = [
        pkg.dependencies?.next && 'Next.js',
        pkg.dependencies?.react && 'React',
        pkg.dependencies?.express && 'Express',
        pkg.dependencies?.probot && 'Probot',
        pkg.dependencies?.fastify && 'Fastify',
      ]
        .filter(Boolean)
        .join(', ');
    }
    if (meta['go.mod']) {
      context.language = 'Go';
      context.framework = detectGoFramework(meta['go.mod']);
    }
    if (meta['requirements.txt']) {
      context.language = context.language ? `${context.language}, Python` : 'Python';
    }
    if (meta['Cargo.toml']) {
      context.language = context.language ? `${context.language}, Rust` : 'Rust';
    }
    if (!context.language && files.length > 0) {
      context.language = guessLanguageFromFiles(files.map((f) => f.filename));
    }
  } catch {
    // Non-blocking
  }

  return {
    owner: client.owner,
    repo: client.repo,
    prNumber,
    title: pr.title,
    body: pr.body ?? '',
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    files,
    diff,
    context,
    trigger,
  };
}

// ---- Helpers ----

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function detectGoFramework(goMod: string): string {
  const frameworks: string[] = [];
  if (goMod.includes('gin-gonic/gin')) frameworks.push('Gin');
  if (goMod.includes('labstack/echo')) frameworks.push('Echo');
  if (goMod.includes('gofiber/fiber')) frameworks.push('Fiber');
  return frameworks.join(', ');
}

function guessLanguageFromFiles(filenames: string[]): string {
  const exts = new Set(filenames.map((f) => f.split('.').pop()?.toLowerCase()));
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript/React',
    js: 'JavaScript',
    jsx: 'JavaScript/React',
    go: 'Go',
    py: 'Python',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    swift: 'Swift',
  };
  const languages = [...new Set([...exts].map((e) => map[e ?? '']).filter(Boolean))];
  return languages.join(', ');
}
