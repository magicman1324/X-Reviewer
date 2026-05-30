import { parseReviewReport } from '../src/services/output-parser.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.warn(`  ✗ FAIL: ${label}`);
  }
}

const pr = { prNumber: 1 };

// ------- Tier 1: Clean JSON -------
console.log('\nTier 1: Clean JSON parse');
{
  const raw = JSON.stringify({
    summary: 'Adds audio capture module.',
    risks: [
      {
        level: 'critical',
        file: 'src/audio.ts',
        line: 42,
        title: 'getUserMedia not wrapped',
        description: 'Mic denial causes unhandled rejection.',
        suggestion: 'Wrap in try-catch.',
        fixCode: 'try { await getUserMedia(...) } catch (e) {}',
        confidence: 0.95,
        isFalsePositiveLikely: false,
      },
    ],
    overallScore: 7,
    suggestedLabels: ['bug-risk'],
  });
  const report = parseReviewReport(raw, pr);
  assert('summary extracted', report.summary.includes('audio capture'));
  assert('risk file correct', report.risks[0].file === 'src/audio.ts');
  assert('risk level correct', report.risks[0].level === 'critical');
  assert('overall score 7', report.overallScore === 7);
}

// ------- Tier 1: Markdown-fenced JSON -------
console.log('\nTier 1: Markdown-fenced JSON');
{
  const raw = 'Here is the review:\n```json\n{"summary":"Fix bug","risks":[],"overallScore":9,"suggestedLabels":[]}\n```';
  const report = parseReviewReport(raw, pr);
  assert('fenced JSON parsed', report.summary === 'Fix bug');
  assert('score 9', report.overallScore === 9);
}

// ------- Tier 1: JSON with surrounding text -------
console.log('\nTier 1: JSON with surrounding text');
{
  const raw = 'Analysis complete:\n\n{\n  "summary": "Refactor utils",\n  "risks": [],\n  "overallScore": 8,\n  "suggestedLabels": []\n}\n\nHope this helps!';
  const report = parseReviewReport(raw, pr);
  assert('extracts from mixed text', report.summary === 'Refactor utils');
}

// ------- Tier 2: Regex fallback - English format -------
console.log('\nTier 2: Regex fallback — English');
{
  const raw = `Summary: This PR introduces a new Web Audio API module for real-time audio capture.

Risk 1: [critical] src/audio.ts:42 - getUserMedia is not wrapped in try-catch, which can cause an unhandled promise rejection if the user denies microphone permissions.

Risk 2: [warning] src/utils.ts:18 - Unused temporary variable "temp" left in the code.

Suggestion: For risk 1, wrap the getUserMedia call in try-catch and provide a user-friendly error message. For risk 2, remove the unused variable.

Score: 6.5/10`;
  const report = parseReviewReport(raw, pr);
  assert('regex extracts summary', report.summary.includes('Web Audio API'));
  assert('regex finds 2 risks', report.risks.length === 2);
  assert('first risk critical', report.risks[0].level === 'critical');
  assert('first risk file', report.risks[0].file === 'src/audio.ts');
  assert('first risk line 42', report.risks[0].line === 42);
  assert('second risk warning', report.risks[1].level === 'warning');
  assert('second risk file', report.risks[1].file === 'src/utils.ts');
  assert('regex extracts score', report.overallScore === 6.5);
  assert('suggestion extracted', report.risks[0].suggestion.includes('try-catch'));
}

// ------- Tier 2: Regex fallback — Chinese format -------
console.log('\nTier 2: Regex fallback — Chinese');
{
  const raw = `总结：本次 PR 在用户认证模块中修复了一个 SQL 注入漏洞。

风险1：[高危] src/auth/login.ts:23 - 用户输入未经过滤直接拼接到 SQL 查询中

建议：使用参数化查询替代字符串拼接

评分：4/10`;
  const report = parseReviewReport(raw, pr);
  assert('Chinese summary extracted', report.summary.includes('SQL 注入'));
  assert('Chinese risk critical', report.risks[0].level === 'critical');
  assert('Chinese risk file', report.risks[0].file === 'src/auth/login.ts');
  assert('Chinese score', report.overallScore === 4);
}

// ------- Tier 3: Complete garbage -------
console.log('\nTier 3: Complete garbage input');
{
  const raw = 'asdlfkjas;dlfkjas;dlfkjasdf';
  const report = parseReviewReport(raw, pr);
  assert('tier 3 fallback used', report.suggestedLabels.includes('ai-parse-failed'));
  assert('score 0 on garbage', report.overallScore === 0);
  assert('risks empty', report.risks.length === 0);
  assert('summary mentions PR', report.summary.includes('#1'));
}

// ------- Tier 3: Empty string -------
console.log('\nTier 3: Empty string');
{
  const report = parseReviewReport('', pr);
  assert('empty string → empty report', report.suggestedLabels.includes('ai-parse-failed'));
}

// ------- Edge: Malformed JSON → falls to regex -------
console.log('\nEdge: Malformed JSON → regex fallback');
{
  const raw = `Summary: Fix XSS in chat component
Risk 1: [critical] src/chat.ts:15 - innerHTML used with unsanitized user input
Score: 3

{broken json here: missing closing brace `;
  const report = parseReviewReport(raw, pr);
  assert('falls back to regex', report.risks.length > 0);
  assert('extracts risk from regex', report.risks[0].file === 'src/chat.ts');
  assert('extracts line 15', report.risks[0].line === 15);
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
