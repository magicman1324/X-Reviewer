import { parseReviewReport } from '../src/services/ai-engine.js';
import { DeepSeekProvider } from '../src/providers/deepseek.js';
import { TriggerSource, type ReviewRequest, type FilteredDiff } from '../src/types/index.js';

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

function makeRequest(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  const diff: FilteredDiff = {
    raw: '',
    businessPatches: [{ filename: 'src/main.ts', patch: '+const x = 1;', lines: 1 }],
    noiseFiles: [],
  };
  return {
    owner: 'test', repo: 'test', prNumber: 1,
    title: 'Test PR', body: '',
    headSha: 'abc1234', baseSha: 'def5678',
    files: [],
    diff,
    context: { linkedIssues: [] },
    trigger: TriggerSource.PR_Opened,
    ...overrides,
  };
}

// ------- Test 1: Parse clean JSON response -------
console.log('\nTest 1: Parse clean JSON response');
{
  const raw = JSON.stringify({
    summary: 'This PR adds an audio capture module.',
    risks: [
      {
        level: 'critical',
        file: 'src/audio.ts',
        line: 42,
        title: 'getUserMedia not wrapped in try-catch',
        description: 'If the user denies mic access, the promise rejects unhandled.',
        suggestion: 'Wrap in try-catch with user-facing error feedback.',
        fixCode: 'try { await getUserMedia(...) } catch (e) { handle(e); }',
        confidence: 0.95,
        isFalsePositiveLikely: false,
      },
    ],
    overallScore: 6.5,
    suggestedLabels: ['bug-risk', 'needs-test'],
  });

  const report = parseReviewReport(raw, makeRequest());
  assert('summary matches', report.summary.includes('audio capture'));
  assert('one risk found', report.risks.length === 1);
  assert('risk level is critical', report.risks[0].level === 'critical');
  assert('file path correct', report.risks[0].file === 'src/audio.ts');
  assert('line number correct', report.risks[0].line === 42);
  assert('confidence clamped', report.risks[0].confidence === 0.95);
  assert('fixCode present', report.risks[0].fixCode?.includes('try'));
  assert('overallScore correct', report.overallScore === 6.5);
  assert('labels present', report.suggestedLabels.length === 2);
  assert('analysedAt is ISO timestamp', report.analysedAt.includes('T'));
}

// ------- Test 2: Parse markdown-wrapped JSON -------
console.log('\nTest 2: Parse markdown-wrapped JSON');
{
  const raw = '```json\n{\n  "summary": "Fix null pointer",\n  "risks": [],\n  "overallScore": 8,\n  "suggestedLabels": []\n}\n```';
  const report = parseReviewReport(raw, makeRequest());
  assert('extracts summary from fenced JSON', report.summary === 'Fix null pointer');
  assert('risks empty', report.risks.length === 0);
  assert('score correct', report.overallScore === 8);
}

// ------- Test 3: Degrade on invalid JSON -------
console.log('\nTest 3: Degrade on invalid JSON');
{
  const raw = 'Sorry, I cannot analyze this PR right now.';
  const report = parseReviewReport(raw, makeRequest({ prNumber: 99 }));
  assert('includes PR number in fallback', report.summary.includes('#99'));
  assert('risks empty on fallback', report.risks.length === 0);
  assert('score 0 on fallback', report.overallScore === 0);
  assert('parse-failed label', report.suggestedLabels.includes('ai-parse-failed'));
}

// ------- Test 4: Clamp out-of-range values -------
console.log('\nTest 4: Clamp out-of-range values');
{
  const raw = JSON.stringify({
    summary: 'Test',
    risks: [
      { level: 'invalid', file: 'f', line: -1, title: 't', description: 'd', suggestion: 's', confidence: 2.5 },
    ],
    overallScore: 999,
    suggestedLabels: [],
  });
  const report = parseReviewReport(raw, makeRequest());
  assert('invalid level defaults to warning', report.risks[0].level === 'warning');
  assert('negative line becomes 0', report.risks[0].line === 0);
  assert('confidence >1 clamped to 1', report.risks[0].confidence === 1);
  assert('overallScore >10 clamped to 10', report.overallScore === 10);
}

// ------- Test 5: Missing fields get defaults -------
console.log('\nTest 5: Missing fields get defaults');
{
  const raw = '{}';
  const report = parseReviewReport(raw, makeRequest({ prNumber: 7 }));
  assert('default summary uses PR number', report.summary.includes('#7'));
  assert('default risks empty', report.risks.length === 0);
  assert('default score is 5', report.overallScore === 5);
  assert('default labels empty', report.suggestedLabels.length === 0);
}

// ------- Test 6: DeepSeek provider configuration -------
console.log('\nTest 6: DeepSeek provider configuration');
{
  const provider = new DeepSeekProvider({ apiKey: 'sk-test-key' });
  assert('name is deepseek-v4-pro', provider.name === 'deepseek-v4-pro');
  assert('apiKey stored correctly', (provider as unknown as { apiKey: string }).apiKey === 'sk-test-key');

  const custom = new DeepSeekProvider({
    apiKey: 'sk-custom',
    baseUrl: 'https://custom.api.com/v1',
    model: 'deepseek-custom',
    timeoutMs: 15_000,
  });
  assert('custom baseUrl', (custom as unknown as { baseUrl: string }).baseUrl === 'https://custom.api.com/v1');
  assert('custom model', (custom as unknown as { model: string }).model === 'deepseek-custom');
  assert('custom timeout', (custom as unknown as { timeoutMs: number }).timeoutMs === 15_000);
}

// ------- Test 7: Empty risks array handles gracefully -------
console.log('\nTest 7: Empty risks array handles gracefully');
{
  const raw = JSON.stringify({ summary: 'Looks good', risks: null, overallScore: 9, suggestedLabels: [] });
  const report = parseReviewReport(raw, makeRequest());
  assert('null risks becomes empty array', report.risks.length === 0);
}

// ------- Test 8: Confidence default when missing -------
console.log('\nTest 8: Confidence default when missing');
{
  const raw = JSON.stringify({
    summary: 'OK',
    risks: [{ level: 'warning', file: 'x.ts', line: 1, title: 't', description: 'd', suggestion: 's' }],
    overallScore: 5,
    suggestedLabels: [],
  });
  const report = parseReviewReport(raw, makeRequest());
  assert('missing confidence defaults to 0.5', report.risks[0].confidence === 0.5);
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
