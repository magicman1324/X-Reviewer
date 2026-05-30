import type { GitHubClient } from '../utils/github-client.js';
import type { ReviewReport } from '../types/index.js';

const PLACEHOLDERS = [
  '🤖 *X-Reviewer is scanning the diff with laser focus...*',
  '🔍 *Decoding your code changes... this should take <30 seconds.*',
  '🧠 *AI is reasoning about every + / − line... stand by.*',
  '⚡ *Review engine spooling up — report incoming soon!*',
];

const DELAY_NOTICE = (
  elapsed: number,
) => `⏳ *Still working...* (${elapsed}s elapsed)\n\nThis PR is a bit more complex than usual. The AI is doing a deeper analysis — hang tight.`;

const MAX_WAIT_MS = 60_000;
const UPDATE_RETRY_MAX = 2;

export interface CommentContext {
  client: GitHubClient;
  prNumber: number;
  commentId: number;
}

/**
 * Manages the lifecycle of PR review comments:
 *   T+0s  — Post a witty placeholder
 *   T+30s — Seamlessly replace with the AI report
 *   T+60s — If still pending, update placeholder with elapsed notice
 */
export class CommentManager {
  /**
   * Post a placeholder comment and return the comment ID.
   */
  async postPlaceholder(client: GitHubClient, prNumber: number): Promise<number> {
    const text = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
    return client.createComment(prNumber, text);
  }

  /**
   * Replace the placeholder with the final review report.
   * Retries once on failure.
   */
  async publishReport(
    client: GitHubClient,
    commentId: number,
    report: ReviewReport,
  ): Promise<void> {
    const body = formatReportComment(report);
    for (let attempt = 0; attempt <= UPDATE_RETRY_MAX; attempt++) {
      try {
        await client.updateComment(commentId, body);
        return;
      } catch (err) {
        if (attempt === UPDATE_RETRY_MAX) throw err;
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  /**
   * Start a delayed notice timer. If the main analysis hasn't completed
   * within the interval, the placeholder text is bumped with an elapsed-time message.
   *
   * Returns a cleanup function — call it when the report publishes successfully
   * to cancel the timer.
   */
  startDelayNotice(
    client: GitHubClient,
    commentId: number,
  ): () => void {
    const start = Date.now();
    let cancelled = false;

    const timer = setTimeout(async () => {
      if (cancelled) return;
      const elapsed = Math.round((Date.now() - start) / 1000);
      const notice = DELAY_NOTICE(elapsed);
      await client.updateComment(commentId, notice).catch(() => {
        // Silent — the final report will overwrite anyhow
      });
    }, MAX_WAIT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }

  /**
   * Convenience: post placeholder → wait for report → publish → cleanup.
   */
  async orchestrate(
    client: GitHubClient,
    prNumber: number,
    runReview: () => Promise<ReviewReport>,
  ): Promise<ReviewReport> {
    const commentId = await this.postPlaceholder(client, prNumber);
    const cancelDelay = this.startDelayNotice(client, commentId);

    try {
      const report = await runReview();
      cancelDelay();
      await this.publishReport(client, commentId, report);
      return report;
    } catch (err) {
      cancelDelay();
      const errorBody = `❌ *X-Reviewer encountered an error while analyzing this PR.*\n\n> ${(err as Error).message}`;
      await client.updateComment(commentId, errorBody).catch(() => {});
      throw err;
    }
  }
}

const RISK_FOLD_THRESHOLD = 5;
const FIX_FOLD_THRESHOLD = 2;
const FIX_CODE_LINE_THRESHOLD = 20;

/**
 * Detect programming language from a filename for syntax-highlighted code blocks.
 */
function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sh: 'bash',
    bash: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    json: 'json',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    dockerfile: 'dockerfile',
    md: 'markdown',
  };
  return langMap[ext] ?? '';
}

/**
 * Render a structured ReviewReport as a GitHub-flavored Markdown comment.
 * Long reports use <details>/<summary> folding to keep the PR thread readable.
 */
export function formatReportComment(report: ReviewReport): string {
  const lines: string[] = [];

  lines.push('## 🤖 X-Reviewer AI 代码评审报告');
  lines.push('');
  lines.push('### 📝 PR 变更总结');
  lines.push(report.summary);
  lines.push('');

  if (report.risks.length > 0) {
    const longRisk = report.risks.length > RISK_FOLD_THRESHOLD;
    if (longRisk) {
      lines.push(
        `<details open><summary><b>⚠️ 风险代码识别</b> (${report.risks.length} 项)</summary>`,
      );
      lines.push('');
    } else {
      lines.push('### ⚠️ 风险代码识别');
    }
    lines.push('');
    lines.push('| 级别 | 文件 | 行号 | 问题 | 建议 |');
    lines.push('|------|------|------|------|------|');

    for (const risk of report.risks) {
      const icon = risk.level === 'critical' ? '🔴 高危' : '🟡 警告';
      const confidenceBadge =
        risk.confidence < 0.6 ? ' 🤔' : risk.confidence >= 0.9 ? ' 🎯' : '';
      lines.push(
        `| ${icon}${confidenceBadge} | \`${risk.file}\` | L${risk.line} | ${escapeCell(risk.title)} | ${escapeCell(risk.suggestion)} |`,
      );
    }
    lines.push('');

    if (longRisk) {
      lines.push('</details>');
      lines.push('');
    }
  }

  const fixRisks = report.risks.filter((r) => r.fixCode);
  if (fixRisks.length > 0) {
    const longFix = fixRisks.length > FIX_FOLD_THRESHOLD;
    if (longFix) {
      lines.push(
        `<details><summary><b>💡 修复建议</b> (${fixRisks.length} 项)</summary>`,
      );
      lines.push('');
    } else {
      lines.push('### 💡 修复建议');
    }
    lines.push('');

    for (const risk of fixRisks) {
      const lang = detectLanguage(risk.file);
      const code = risk.fixCode!.trim();
      const codeLines = code.split('\n').length;
      const needsFold = codeLines > FIX_CODE_LINE_THRESHOLD;

      lines.push(`**\`${risk.file}:L${risk.line}\`**`);

      if (risk.description) {
        lines.push(`> ${escapeCell(risk.description)}`);
        lines.push('');
      }

      if (needsFold) {
        lines.push(`<details><summary>📎 展开代码 (${codeLines} 行)</summary>`);
        lines.push('');
      }

      lines.push(`\`\`\`${lang}`);
      lines.push(code);
      lines.push('```');

      if (needsFold) {
        lines.push('');
        lines.push('</details>');
      }

      lines.push('');
    }

    if (longFix) {
      lines.push('</details>');
      lines.push('');
    }
  }

  lines.push('### 📊 评审评分');
  const scoreEmoji = report.overallScore >= 8 ? '✅' : report.overallScore >= 5 ? '⚠️' : '🔴';
  lines.push(
    `综合评分: **${report.overallScore.toFixed(1)}/10** ${scoreEmoji}${scoreLabel(report.overallScore)}`,
  );

  if (report.suggestedLabels.length > 0) {
    lines.push('');
    lines.push('**建议标签**: ' + report.suggestedLabels.map((l) => `\`${l}\``).join(' '));
  }

  lines.push('');
  lines.push('---');
  lines.push(
    `<sub>🤖 Generated by [X-Reviewer](https://github.com/magicman1324/X-Reviewer) at ${report.analysedAt}</sub>`,
  );

  return lines.join('\n');
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function scoreLabel(score: number): string {
  if (score >= 9) return ' — 代码质量优秀';
  if (score >= 7) return ' — 整体良好，少量改进建议';
  if (score >= 5) return ' — 存在明显问题需修复';
  return ' — 建议重构';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
