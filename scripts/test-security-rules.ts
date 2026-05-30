import { SecurityScanner } from '../src/security/rules-engine.js';
import { ALL_RULES, getRuleById, getRuleCount } from '../src/security/rules-registry.js';
import { RiskLevel, type ChangedFile, type FilteredDiff } from '../src/types/index.js';

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

function makeFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    filename: 'src/app.ts',
    status: 'modified',
    additions: 3,
    deletions: 0,
    isNoise: false,
    patch: `@@ -1,3 +1,5 @@
 console.log('hello');
+const input = req.body.user;
+document.getElementById('app').innerHTML = input;
+eval(input);
`,
    ...overrides,
  };
}

function makeDiffPatch(overrides: Partial<FilteredDiff['businessPatches'][0]> = {}) {
  return {
    filename: 'src/handler.ts',
    patch: `@@ -5,6 +5,8 @@
 function handle(req) {
+  const q = req.query.id;
+  const sql = 'SELECT * FROM users WHERE id = ' + q;
+  db.query(sql);
 }`,
    lines: 4,
    ...overrides,
  };
}

// ------- Test 1: Rule registry has expected rules -------
console.log('\nTest 1: Rule registry structure');
{
  assert('has rules', getRuleCount() >= 12);
  assert('XSS rule exists', ALL_RULES.some((r) => r.id === 'SEC-XSS-001'));
  assert('eval rule exists', ALL_RULES.some((r) => r.id === 'SEC-INJ-001'));
  assert('secret rule exists', ALL_RULES.some((r) => r.id === 'SEC-SCR-001'));
  assert('SQL injection rule exists', ALL_RULES.some((r) => r.id === 'SEC-INJ-003'));
  assert('path traversal rule exists', ALL_RULES.some((r) => r.id === 'SEC-PATH-001'));
  assert('getRuleById finds rule', getRuleById('SEC-XSS-001')?.title.includes('innerHTML'));
  assert('getRuleById returns undefined for unknown', getRuleById('NONEXISTENT') === undefined);
}

// ------- Test 2: Scanner detects innerHTML XSS -------
console.log('\nTest 2: Detect innerHTML XSS');
{
  const scanner = new SecurityScanner();
  const files = [makeFile({ patch: '@@ -1,0 +1 @@\n+div.innerHTML = userInput;' })];
  const result = scanner.scanFiles(files);
  assert('detects innerHTML', result.risks.some((r) => r.ruleRef === 'SEC-XSS-001'));
  assert('at least 1 risk', result.risks.length >= 1);
}

// ------- Test 3: Scanner detects eval() -------
console.log('\nTest 3: Detect eval()');
{
  const scanner = new SecurityScanner();
  const files = [makeFile({ patch: '@@ -1,0 +1 @@\n+eval(userCode);' })];
  const result = scanner.scanFiles(files);
  assert('detects eval', result.risks.some((r) => r.ruleRef === 'SEC-INJ-001'));
}

// ------- Test 4: Scanner detects hardcoded secret -------
console.log('\nTest 4: Detect hardcoded secret');
{
  const scanner = new SecurityScanner();
  const files = [
    makeFile({
      patch: '@@ -1,0 +1 @@\n+const apiKey = "sk-abc123def456ghijklmnopqrstuvwxyz";',
      filename: 'src/config.ts',
    }),
  ];
  const result = scanner.scanFiles(files);
  assert('detects secret', result.risks.some((r) => r.ruleRef === 'SEC-SCR-001'));
}

// ------- Test 5: Scanner detects SQL injection -------
console.log('\nTest 5: Detect SQL injection');
{
  const scanner = new SecurityScanner();
  const files = [makeFile({ patch: '@@ -1,0 +1 @@\n+const q = "SELECT * FROM users WHERE name = \'" + userName + "\'";' })];
  const result = scanner.scanFiles(files);
  assert('detects SQL injection', result.risks.some((r) => r.ruleRef === 'SEC-INJ-003'));
}

// ------- Test 6: Scanner detects command injection -------
console.log('\nTest 6: Detect command injection');
{
  const scanner = new SecurityScanner();
  const files = [
    makeFile({
      patch: "@@ -1,0 +1 @@\n+exec(`grep ${userInput} /var/log/app.log`);",
      filename: 'src/util.ts',
    }),
  ];
  const result = scanner.scanFiles(files);
  assert('detects exec', result.risks.some((r) => r.ruleRef === 'SEC-INJ-004'));
}

// ------- Test 7: Scanner skips noise files -------
console.log('\nTest 7: Skips noise files');
{
  const scanner = new SecurityScanner();
  const files = [
    {
      filename: 'package-lock.json',
      status: 'modified' as const,
      additions: 1,
      deletions: 0,
      isNoise: true,
      patch: '@@ -1,0 +1 @@\n+eval(bad);',
    },
  ];
  const result = scanner.scanFiles(files);
  assert('skips noise files', result.risks.length === 0);
}

// ------- Test 8: Scanner detects dangerouslySetInnerHTML -------
console.log('\nTest 8: Detect dangerouslySetInnerHTML');
{
  const scanner = new SecurityScanner();
  const files = [
    makeFile({
      patch: '@@ -1,0 +1 @@\n+<div dangerouslySetInnerHTML={{__html: userContent}} />',
      filename: 'src/component.tsx',
    }),
  ];
  const result = scanner.scanFiles(files);
  assert('detects react XSS', result.risks.some((r) => r.ruleRef === 'SEC-XSS-002'));
}

// ------- Test 9: Critical only mode -------
console.log('\nTest 9: Critical only mode');
{
  const scanner = new SecurityScanner();
  const files = [
    makeFile({
      patch: '@@ -1,0 +1 @@\n+document.write(userContent);',
      filename: 'src/x.ts',
    }),
  ];
  const result = scanner.scanFiles(files, { criticalOnly: true });
  assert('document.write filtered in criticalOnly', result.risks.length === 0);
}

// ------- Test 10: Max risks limit -------
console.log('\nTest 10: Max risks limit');
{
  const scanner = new SecurityScanner();
  const patch = '@@ -1,0 +1,50 @@\n' + Array.from({ length: 50 }, (_, i) => `+eval(line${i});`).join('\n');
  const files = [makeFile({ patch })];
  const result = scanner.scanFiles(files, { maxRisks: 3 });
  assert('respects maxRisks', result.risks.length <= 3);
}

// ------- Test 11: Dedup on same line -------
console.log('\nTest 11: Dedup on same line');
{
  const scanner = new SecurityScanner();
  const files = [makeFile({ patch: '@@ -1,0 +1 @@\n+eval(input);' })];
  const result = scanner.scanFiles(files);
  const evalRisks = result.risks.filter((r) => r.ruleRef === 'SEC-INJ-001');
  assert('only one eval per line', evalRisks.length === 1);
}

// ------- Test 12: scanDiff with FilteredDiff -------
console.log('\nTest 12: scanDiff with FilteredDiff');
{
  const scanner = new SecurityScanner();
  const diff: FilteredDiff = {
    raw: 'diff --git a/src/handler.ts b/src/handler.ts',
    businessPatches: [makeDiffPatch()],
    noiseFiles: ['package-lock.json'],
  };
  const result = scanner.scanDiff(diff);
  assert('scans business patches', result.risks.length >= 1);
  assert('filesScanned = 1', result.filesScanned === 1);
  assert('detects SQL injection in diff', result.risks.some((r) => r.ruleRef === 'SEC-INJ-003'));
}

// ------- Test 13: mergeWithAIReport deduplicates -------
console.log('\nTest 13: mergeWithAIReport deduplicates');
{
  const scanner = new SecurityScanner();
  const aiRisks = [
    {
      level: RiskLevel.Critical, file: 'src/app.ts', line: 5,
      title: 'XSS risk', description: 'desc', suggestion: 'sug',
      confidence: 0.9, isFalsePositiveLikely: false,
    },
  ];
  const secRisks = [
    {
      level: RiskLevel.Critical, file: 'src/app.ts', line: 5,
      title: 'innerHTML XSS', description: 'desc', suggestion: 'sug',
      confidence: 0.92, ruleRef: 'SEC-XSS-001', isFalsePositiveLikely: false,
    },
    {
      level: RiskLevel.Critical, file: 'src/other.ts', line: 10,
      title: 'eval risk', description: 'desc', suggestion: 'sug',
      confidence: 0.92, ruleRef: 'SEC-INJ-001', isFalsePositiveLikely: false,
    },
  ];
  const merged = scanner.mergeWithAIReport(aiRisks, secRisks);
  assert('dedup on same file+line', merged.length === 2);
  assert('includes non-overlapping security risk', merged.some((r) => r.file === 'src/other.ts'));
}

// ------- Test 14: Rules have required fields -------
console.log('\nTest 14: Rules have required fields');
{
  for (const rule of ALL_RULES) {
    assert(`${rule.id} has id`, rule.id.length > 0);
    assert(`${rule.id} has title`, rule.title.length > 0);
    assert(`${rule.id} has description`, rule.description.length > 0);
    assert(`${rule.id} has suggestion`, rule.suggestion.length > 0);
    assert(`${rule.id} has patterns`, rule.patterns.length > 0);
    assert(`${rule.id} has valid level`, [RiskLevel.Critical, RiskLevel.Warning].includes(rule.level));
  }
}

// ------- Test 15: RiskItem has ruleRef when from security rule -------
console.log('\nTest 15: RiskItem has ruleRef');
{
  const scanner = new SecurityScanner();
  const files = [makeFile({ patch: '@@ -1,0 +1 @@\n+eval(1);' })];
  const result = scanner.scanFiles(files);
  assert('ruleRef set on security risk', result.risks.every((r) => typeof r.ruleRef === 'string'));
}

// ------- Test 16: Custom rules injected -------
console.log('\nTest 16: Custom rules');
{
  const customRule = {
    id: 'CUSTOM-001',
    title: 'Custom bad pattern',
    description: 'Detects fooBar',
    suggestion: 'Do not use fooBar',
    level: RiskLevel.Warning,
    patterns: [/fooBar\s*\(/],
    fileGlobs: [] as string[],
    hasAutoFix: false,
  };
  const scanner = new SecurityScanner();
  const files = [makeFile({ patch: '@@ -1,0 +1 @@\n+fooBar(42);' })];
  const result = scanner.scanFiles(files, { customRules: [customRule] });
  assert('custom rule triggered', result.risks.some((r) => r.ruleRef === 'CUSTOM-001'));
}

// ------- Test 17: File glob filtering -------
console.log('\nTest 17: File glob filtering');
{
  const scanner = new SecurityScanner();
  // dangerouslySetInnerHTML rule only applies to tsx/jsx
  const tsFile = makeFile({
    patch: '@@ -1,0 +1 @@\n+dangerouslySetInnerHTML',
    filename: 'src/app.ts',
  });
  const tsxFile = makeFile({
    patch: '@@ -1,0 +1 @@\n+dangerouslySetInnerHTML',
    filename: 'src/component.tsx',
  });
  const resultTs = scanner.scanFiles([tsFile]);
  const resultTsx = scanner.scanFiles([tsxFile]);
  // Rule only applies to tsx/jsx per fileGlobs
  const tsDetected = resultTs.risks.some((r) => r.ruleRef === 'SEC-XSS-002');
  const tsxDetected = resultTsx.risks.some((r) => r.ruleRef === 'SEC-XSS-002');
  assert('rule NOT applied to .ts file (not in glob)', !tsDetected);
  assert('rule applied to .tsx file', tsxDetected);
}

// ------- Test 18: Private key detection -------
console.log('\nTest 18: Private key detection');
{
  const scanner = new SecurityScanner();
  const files = [
    makeFile({
      patch: '@@ -1,0 +1,5 @@\n+-----BEGIN RSA PRIVATE KEY-----\n+MIIEpAIBAAKCAQEA...\n+-----END RSA PRIVATE KEY-----',
      filename: 'src/keys.ts',
    }),
  ];
  const result = scanner.scanFiles(files);
  assert('detects private key', result.risks.some((r) => r.ruleRef === 'SEC-SCR-001'));
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
