import { ReviewPostProcessor } from '../src/services/review-post-processor.js';
import { RiskLevel, type RiskItem, type ReviewReport } from '../src/types/index.js';

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

function mkRisk(overrides: Partial<RiskItem> = {}): RiskItem {
  return {
    level: RiskLevel.Warning,
    file: 'src/app.ts',
    line: 10,
    title: 'Unvalidated input used in query',
    description: 'User input passed directly to database query.',
    suggestion: 'Validate and sanitize input before use.',
    confidence: 0.75,
    isFalsePositiveLikely: false,
    ...overrides,
  };
}

function mkReport(risks: RiskItem[], score = 7): ReviewReport {
  return {
    summary: 'Test report',
    risks,
    overallScore: score,
    suggestedLabels: [],
    analysedAt: '2026-05-30T12:00:00.000Z',
  };
}

// ------- Test 1: Low confidence → flagged as likely FP -------
console.log('\nTest 1: Low confidence → false positive');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ confidence: 0.2 })];
  const result = processor.detectFalsePositives(risks);
  assert('flagged as likely FP', result[0].isFalsePositiveLikely);
}

// ------- Test 2: High confidence → NOT flagged -------
console.log('\nTest 2: High confidence → NOT flagged');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ confidence: 0.95 })];
  const result = processor.detectFalsePositives(risks);
  assert('not flagged', !result[0].isFalsePositiveLikely);
}

// ------- Test 3: Vague title → false positive -------
console.log('\nTest 3: Vague title → false positive');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ title: 'fix this code', confidence: 0.55 })];
  const result = processor.detectFalsePositives(risks);
  assert('vague title flagged', result[0].isFalsePositiveLikely);
}

// ------- Test 4: Test file risk → flagged -------
console.log('\nTest 4: Test file risk → false positive');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ file: 'src/__tests__/app.test.ts', confidence: 0.45 })];
  const result = processor.detectFalsePositives(risks);
  assert('test file flagged', result[0].isFalsePositiveLikely);
}

// ------- Test 5: Config file warning → flagged -------
console.log('\nTest 5: Config file warning → flagged');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ file: 'tsconfig.json', confidence: 0.5 })];
  const result = processor.detectFalsePositives(risks);
  assert('config file warning flagged', result[0].isFalsePositiveLikely);
}

// ------- Test 6: Short title + low confidence → flagged -------
console.log('\nTest 6: Short title + low confidence');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ title: 'Bug here', confidence: 0.3 })];
  const result = processor.detectFalsePositives(risks);
  assert('short vague flagged', result[0].isFalsePositiveLikely);
}

// ------- Test 7: Security rule match boosts confidence -------
console.log('\nTest 7: Security rule match boosts confidence');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ confidence: 0.8, ruleRef: 'SEC-XSS-001' })];
  const result = processor.adjustConfidence(risks);
  assert('confidence boosted by ruleRef', result[0].confidence > 0.8);
}

// ------- Test 8: Node modules path gets large penalty -------
console.log('\nTest 8: node_modules path penalty');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ file: 'node_modules/some-lib/index.js', confidence: 0.8 })];
  const result = processor.adjustConfidence(risks);
  assert('node_modules heavily penalized', result[0].confidence < 0.5);
}

// ------- Test 9: Generated file penalty -------
console.log('\nTest 9: Generated file penalty');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ file: 'src/types.generated.ts', confidence: 0.7 })];
  const result = processor.adjustConfidence(risks);
  assert('generated file penalized', result[0].confidence < 0.5);
}

// ------- Test 10: Confidence clamping to [0, 1] -------
console.log('\nTest 10: Confidence clamping');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ confidence: 1.2, ruleRef: 'SEC-001', file: 'src/app.ts' })];
  const result = processor.adjustConfidence(risks);
  // With ruleRef boost max it should still be clamped
  assert('high clamped to 1', result[0].confidence <= 1);
}

// ------- Test 11: Cross-validation with security scan -------
console.log('\nTest 11: Cross-validation with security scanner');
{
  const processor = new ReviewPostProcessor();
  const aiRisks = [mkRisk({ file: 'src/x.ts', line: 42, confidence: 0.7 })];
  const secRisks = [
    {
      level: RiskLevel.Critical, file: 'src/x.ts', line: 42,
      title: 'XSS risk', description: '', suggestion: '',
      confidence: 0.92, ruleRef: 'SEC-XSS-001', isFalsePositiveLikely: false,
    },
  ];
  const result = processor.crossValidate(aiRisks, secRisks);
  assert('confidence boosted on match', result[0].confidence > 0.7);
  assert('ruleRef added from security', result[0].ruleRef === 'SEC-XSS-001');
  assert('FP flag cleared', !result[0].isFalsePositiveLikely);
}

// ------- Test 12: Cross-validation no match leaves unchanged -------
console.log('\nTest 12: Cross-validation no match');
{
  const processor = new ReviewPostProcessor();
  const aiRisks = [mkRisk({ file: 'src/x.ts', line: 42, confidence: 0.7 })];
  const secRisks = [
    {
      level: RiskLevel.Critical, file: 'src/other.ts', line: 99,
      title: 'Other', description: '', suggestion: '',
      confidence: 0.92, ruleRef: 'SEC-INJ-001', isFalsePositiveLikely: false,
    },
  ];
  const result = processor.crossValidate(aiRisks, secRisks);
  assert('no match = unchanged confidence', result[0].confidence === 0.7);
  assert('no match = no ruleRef', result[0].ruleRef === undefined);
}

// ------- Test 13: detectMissedRisks finds gaps -------
console.log('\nTest 13: detectMissedRisks');
{
  const processor = new ReviewPostProcessor();
  const aiRisks = [mkRisk({ file: 'src/a.ts', line: 10 })];
  const secRisks = [
    {
      level: RiskLevel.Critical, file: 'src/a.ts', line: 10,
      title: 'Match', description: '', suggestion: '',
      confidence: 0.9, ruleRef: 'SEC-XSS-001', isFalsePositiveLikely: false,
    },
    {
      level: RiskLevel.Critical, file: 'src/b.ts', line: 20,
      title: 'Missed', description: '', suggestion: '',
      confidence: 0.93, ruleRef: 'SEC-INJ-001', isFalsePositiveLikely: false,
    },
  ];
  const missed = processor.detectMissedRisks(aiRisks, secRisks);
  assert('finds 1 missed risk', missed.length === 1);
  assert('missed risk is SEC-INJ-001', missed[0].ruleRef === 'SEC-INJ-001');
}

// ------- Test 14: Process full report -------
console.log('\nTest 14: Process full review report');
{
  const processor = new ReviewPostProcessor();
  const risks = [
    mkRisk({ confidence: 0.25, title: 'fix this', file: 'src/foo.test.ts', line: 5 }),
    mkRisk({ confidence: 0.88, title: 'Unsafe eval() call in request handler', line: 22 }),
  ];
  const report = mkReport(risks);
  const result = processor.process(report);
  assert('first risk flagged FP', result.risks[0].isFalsePositiveLikely);
  assert('score recalculated', result.overallScore !== report.overallScore);
}

// ------- Test 15: Auto-remove false positives -------
console.log('\nTest 15: Auto-remove false positives');
{
  const processor = new ReviewPostProcessor({ autoRemove: true });
  const risks = [
    mkRisk({ confidence: 0.25, title: 'fix', file: 'src/foo.test.ts', line: 5 }),
    mkRisk({ confidence: 0.9, title: 'SQL injection in query handler' }),
  ];
  const report = mkReport(risks);
  const result = processor.process(report);
  assert('FP removed', result.risks.length === 1);
  assert('remaining risk is high-conf', result.risks[0].confidence >= 0.9);
}

// ------- Test 16: Downgrade uncertain Critical → Warning -------
console.log('\nTest 16: Downgrade uncertain Critical → Warning');
{
  const processor = new ReviewPostProcessor({ downgradeUncertain: true });
  const risks = [
    mkRisk({ level: RiskLevel.Critical, confidence: 0.3, title: 'maybe bug', file: 'src/x.test.ts' }),
  ];
  const report = mkReport(risks);
  const result = processor.process(report);
  assert('flagged FP', result.risks[0].isFalsePositiveLikely);
  assert('downgraded to warning', result.risks[0].level === RiskLevel.Warning);
}

// ------- Test 17: Custom thresholds -------
console.log('\nTest 17: Custom thresholds');
{
  const processor = new ReviewPostProcessor({
    lowConfidenceThreshold: 0.5,
    highConfidenceThreshold: 0.95,
  });
  const risks = [mkRisk({ confidence: 0.45 })];
  const result = processor.detectFalsePositives(risks);
  assert('flagged with custom low threshold', result[0].isFalsePositiveLikely);
}

// ------- Test 18: Empty risks handled -------
console.log('\nTest 18: Empty risks');
{
  const processor = new ReviewPostProcessor();
  const report = mkReport([], 9.5);
  const result = processor.process(report);
  assert('no crash on empty', result.risks.length === 0);
  assert('score preserved or higher', result.overallScore >= 9.5);
}

// ------- Test 19: FP score metadata attached -------
console.log('\nTest 19: FP score metadata');
{
  const processor = new ReviewPostProcessor();
  const risks = [mkRisk({ confidence: 0.15, title: 'fix', file: 'src/x.test.ts' })];
  const result = processor.detectFalsePositives(risks);
  const meta = result[0] as Record<string, unknown>;
  assert('_fpScore present', typeof meta._fpScore === 'number');
  assert('_fpScore >= 3', (meta._fpScore as number) >= 3);
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
