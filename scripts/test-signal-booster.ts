import { SignalBooster, BoostedReport } from '../src/services/signal-booster.js';
import { RiskLevel } from '../src/types/index.js';
import type { RiskItem, ReviewReport } from '../src/types/index.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.warn(`  ✗ FAIL: ${label}`); }
}

function makeRisk(overrides: Partial<RiskItem> = {}): RiskItem {
  return {
    level: RiskLevel.Warning,
    file: 'src/app.ts',
    line: 42,
    title: 'Possible SQL injection in query builder',
    description: 'User input is concatenated directly into SQL string.',
    suggestion: 'Use parameterized queries.',
    confidence: 0.7,
    isFalsePositiveLikely: false,
    ...overrides,
  };
}

function makeReport(risks: RiskItem[]): ReviewReport {
  return {
    summary: 'Test report',
    risks,
    overallScore: 5,
    suggestedLabels: [],
    analysedAt: new Date().toISOString(),
  };
}

const booster = new SignalBooster();

// ---- Test 1: Basic boost pipeline ----
{
  const report = makeReport([
    makeRisk({ level: RiskLevel.Critical, confidence: 0.9, title: 'SQL injection in user query — unescaped input' }),
    makeRisk({ level: RiskLevel.Warning, confidence: 0.3, title: 'fix' }),
  ]);
  const boosted = booster.boost(report);
  assert('returns BoostedReport', 'signalQuality' in boosted && 'clusters' in boosted);
  assert('risks have compositeScore', boosted.risks.every((r) => typeof r.compositeScore === 'number'));
  assert('risks have isNoise flag', boosted.risks.every((r) => typeof r.isNoise === 'boolean'));
}

// ---- Test 2: High-confidence critical gets high score ----
{
  const report = makeReport([
    makeRisk({ level: RiskLevel.Critical, confidence: 0.95, title: 'Remote code execution via eval injection in request handler' }),
  ]);
  const boosted = booster.boost(report);
  assert('critical + high confidence gets high composite score', boosted.risks[0].compositeScore >= 70);
  assert('high-confidence critical is NOT noise', !boosted.risks[0].isNoise);
}

// ---- Test 3: Low confidence vague title is suppressed ----
{
  const report = makeReport([
    makeRisk({ level: RiskLevel.Warning, confidence: 0.15, title: 'fix this', isFalsePositiveLikely: true }),
  ]);
  const boosted = booster.boost(report);
  assert('low-conf vague warning is noise', boosted.risks[0].isNoise);
  assert('has noise reason', !!boosted.risks[0].noiseReason);
  assert('SNR reflects suppression', boosted.signalQuality.suppressedCount >= 1);
}

// ---- Test 4: Deduplication by ruleRef ----
{
  const report = makeReport([
    makeRisk({ ruleRef: 'SEC-002', file: 'src/a.ts', line: 10, title: 'Hardcoded API key' }),
    makeRisk({ ruleRef: 'SEC-002', file: 'src/b.ts', line: 20, title: 'Hardcoded API key' }),
    makeRisk({ ruleRef: 'SEC-002', file: 'src/c.ts', line: 30, title: 'Hardcoded API key' }),
  ]);
  const boosted = booster.boost(report);
  const dupCount = boosted.signalQuality.duplicateCount;
  assert('3 SEC-002 alerts deduplicated', dupCount >= 1);
}

// ---- Test 5: Deduplication by same file + similar title ----
{
  const report = makeReport([
    makeRisk({ file: 'src/user.ts', line: 100, title: 'SQL injection in login query' }),
    makeRisk({ file: 'src/user.ts', line: 105, title: 'SQL injection risk in login handler' }),
  ]);
  const boosted = booster.boost(report);
  assert('similar title in same file deduped', boosted.signalQuality.duplicateCount >= 1);
}

// ---- Test 6: Clustering groups related risks ----
{
  const report = makeReport([
    makeRisk({ ruleRef: 'SEC-001', file: 'src/a.ts', line: 1, title: 'XSS in template renderer', confidence: 0.8 }),
    makeRisk({ ruleRef: 'SEC-001', file: 'src/b.ts', line: 15, title: 'Cross-site scripting in markdown parser', confidence: 0.7 }),
  ]);
  const boosted = booster.boost(report);
  assert('related risks clustered', boosted.clusters.some((c) => c.riskIds.length >= 2));
}

// ---- Test 7: Signal quality metrics are reasonable ----
{
  const risks: RiskItem[] = [
    makeRisk({ level: RiskLevel.Critical, confidence: 0.92, title: 'Remote code execution in file upload handler' }),
    makeRisk({ level: RiskLevel.Warning, confidence: 0.7, title: 'SQL injection in search query builder' }),
    makeRisk({ level: RiskLevel.Warning, confidence: 0.1, title: 'fix', isFalsePositiveLikely: true }),
  ];
  const boosted = booster.boost(reportWith(risks));
  assert('SNR is 0-1', boosted.signalQuality.signalToNoiseRatio >= 0 && boosted.signalQuality.signalToNoiseRatio <= 1);
  assert('overallTrust is 0-1', boosted.signalQuality.overallTrust >= 0 && boosted.signalQuality.overallTrust <= 1);
  assert('suppressed 1 noise', boosted.signalQuality.suppressedCount === 1);
}

// ---- Test 8: Empty report is handled ----
{
  const boosted = booster.boost(makeReport([]));
  assert('empty report has SNR 1', boosted.signalQuality.signalToNoiseRatio === 1);
  assert('empty report has 0 clusters', boosted.clusters.length === 0);
}

// ---- Test 9: All noise report ----
{
  const risks: RiskItem[] = [
    makeRisk({ level: RiskLevel.Warning, confidence: 0.1, title: 'fix' }),
    makeRisk({ level: RiskLevel.Warning, confidence: 0.15, title: 'maybe bug' }),
  ];
  const boosted = booster.boost(reportWith(risks));
  assert('all-noise SNR is 0', boosted.signalQuality.signalToNoiseRatio === 0);
  assert('all-noise trust is low', boosted.signalQuality.overallTrust < 0.3);
}

// ---- Test 10: Cluster fileCount is accurate ----
{
  const report = makeReport([
    makeRisk({ file: 'src/x.ts', line: 1, title: 'Cross-site scripting vulnerability in template engine', confidence: 0.8 }),
    makeRisk({ file: 'src/y.ts', line: 10, title: 'XSS risk in user profile renderer', confidence: 0.8 }),
    makeRisk({ file: 'src/z.ts', line: 20, title: 'Unescaped output leads to XSS in comment widget', confidence: 0.8 }),
  ]);
  const boosted = booster.boost(report);
  const cluster = boosted.clusters.find((c) => c.riskIds.length >= 2);
  assert('cluster has correct fileCount', cluster ? cluster.fileCount === 3 : false);
}

// ---- Test 11: Noise reason is descriptive ----
{
  const risk = makeRisk({ level: RiskLevel.Warning, confidence: 0.15, title: 'fix', isFalsePositiveLikely: true });
  const boosted = booster.boost(reportWith([risk]));
  assert('noise reason mentions confidence', boosted.risks[0].noiseReason!.includes('15%'));
  assert('noise reason mentions FP flag', boosted.risks[0].noiseReason!.includes('false positive'));
}

function reportWith(risks: RiskItem[]): ReviewReport {
  return { summary: '', risks, overallScore: 5, suggestedLabels: [], analysedAt: '' };
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
