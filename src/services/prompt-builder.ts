import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIChatMessage, ReviewRequest } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

let systemTemplate: string | null = null;
let userTemplate: string | null = null;

function loadTemplate(name: string): string {
  try {
    return readFileSync(join(TEMPLATES_DIR, name), 'utf-8').trim();
  } catch {
    return '';
  }
}

function getSystemTemplate(): string {
  systemTemplate ??= loadTemplate('system.md');
  return systemTemplate;
}

function getUserTemplate(): string {
  userTemplate ??= loadTemplate('user.md');
  return userTemplate;
}

/**
 * Minimal Mustache-style template renderer.
 * Supports {{key}}, {{#list}}...{{/list}}, {{^list}}...{{/list}}.
 */
function render(template: string, data: Record<string, unknown>): string {
  let result = template;

  // {{#key}}...{{/key}} sections (truthy → expand; falsy → skip)
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, body: string) => {
      const value = data[key];
      if (Array.isArray(value) && value.length > 0) {
        return value.map((item: Record<string, unknown>) => render(body, item)).join('');
      }
      return '';
    },
  );

  // {{^key}}...{{/key}} inverted sections (falsy → expand)
  result = result.replace(
    /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, body: string) => {
      const value = data[key];
      if (!value || (Array.isArray(value) && value.length === 0)) {
        return body;
      }
      return '';
    },
  );

  // {{key}} simple replacements
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });

  return result;
}

function languageHint(language?: string): string {
  if (!language) return '';
  const lang = language.toLowerCase();
  if (lang.includes('typescript')) return 'typescript';
  if (lang.includes('javascript')) return 'javascript';
  if (lang.includes('go')) return 'go';
  if (lang.includes('python')) return 'python';
  if (lang.includes('rust')) return 'rust';
  if (lang.includes('java')) return 'java';
  if (lang.includes('kotlin')) return 'kotlin';
  return '';
}

/**
 * Custom rules injectable from .x-reviewer.yml or similar config.
 */
export interface CustomReviewRule {
  name: string;
  description: string;
  level: 'error' | 'warn';
  pattern: string;
}

/**
 * Build the full prompt messages array for the AI model.
 */
export function buildPrompt(
  request: ReviewRequest,
  customRules: CustomReviewRule[] = [],
): AIChatMessage[] {
  const system = getSystemTemplate();

  // Inject custom rules into system prompt
  let rulesBlock = '';
  if (customRules.length > 0) {
    rulesBlock =
      '\n## 自定义审查规则（来自 .x-reviewer.yml）\n' +
      customRules
        .map(
          (r) =>
            `- [${r.level === 'error' ? '必须' : '建议'}] ${r.description}（匹配: \`${r.pattern}\`）`,
        )
        .join('\n');
  }

  const hint = languageHint(request.context.language);

  const userData: Record<string, unknown> = {
    title: request.title,
    body: request.body || '（无描述）',
    headSha: request.headSha.slice(0, 7),
    baseSha: request.baseSha.slice(0, 7),
    fileCount: request.files.length,
    trigger: request.trigger,
    linkedIssues: request.context.linkedIssues,
    language: request.context.language ?? '未知',
    framework: request.context.framework ?? '无',
    customRules:
      customRules.length > 0
        ? customRules.map((r) => `- [${r.level}] ${r.description}`).join('\n')
        : '无自定义规则',
    businessPatches: request.diff.businessPatches.map((p) => ({
      filename: p.filename,
      lines: p.lines,
      patch: p.patch,
      languageHint: hint,
    })),
    languageHint: hint,
  };

  const userMessage = render(getUserTemplate(), userData);

  return [
    { role: 'system', content: system + rulesBlock },
    { role: 'user', content: userMessage },
  ];
}

/**
 * JSON Schema that the model is expected to conform to.
 * Sent alongside the user prompt for structured output guidance.
 */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '一句话总结修改目的与影响范围' },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['critical', 'warning'] },
          file: { type: 'string', description: '相对文件路径' },
          line: { type: 'integer', minimum: 1 },
          title: { type: 'string', description: '简短的问题描述' },
          description: { type: 'string', description: '为什么这是一个问题' },
          suggestion: { type: 'string', description: '修复建议' },
          fixCode: { type: 'string', description: '可选的修复代码片段' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          isFalsePositiveLikely: { type: 'boolean' },
        },
        required: ['level', 'file', 'line', 'title', 'description', 'suggestion', 'confidence'],
      },
    },
    overallScore: { type: 'number', minimum: 0, maximum: 10 },
    suggestedLabels: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'risks', 'overallScore', 'suggestedLabels'],
} as const;

/**
 * Restore templates to default (useful for testing).
 */
export function resetTemplates(): void {
  systemTemplate = null;
  userTemplate = null;
}
