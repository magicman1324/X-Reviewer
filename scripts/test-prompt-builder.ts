import { buildPrompt, OUTPUT_SCHEMA, resetTemplates } from '../src/services/prompt-builder.js';
import {
  TriggerSource,
  RiskLevel,
  type ReviewRequest,
  type FilteredDiff,
} from '../src/types/index.js';

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

resetTemplates();

function makeRequest(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  const diff: FilteredDiff = {
    raw: '@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n return x;\n',
    businessPatches: [
      { filename: 'src/main.ts', patch: '@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n return x;\n', lines: 4 },
    ],
    noiseFiles: ['package-lock.json'],
  };

  return {
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 1,
    title: 'Add audio module',
    body: 'This PR adds Web Audio API support. Fixes #42.',
    headSha: 'abc1234567890',
    baseSha: 'def9876543210',
    files: [{ filename: 'src/main.ts', status: 'modified', additions: 1, deletions: 0, isNoise: false }],
    diff,
    context: {
      linkedIssues: [{ number: 42, title: 'Audio recording bug', body: 'Users report microphone access failures.' }],
      language: 'TypeScript',
      framework: 'Probot',
    },
    trigger: TriggerSource.PR_Opened,
    ...overrides,
  };
}

// ------- Test 1: System prompt loads and contains key rules -------
console.log('\nTest 1: System prompt contains key rules');
{
  const messages = buildPrompt(makeRequest());
  const system = messages.find((m) => m.role === 'system')!.content;
  assert('system prompt exists', system.length > 100);
  assert('contains risk levels', system.includes('critical') && system.includes('warning'));
  assert('contains review principles', system.includes('审查原则'));
  assert('contains JSON requirement', system.includes('JSON'));
  assert('contains output constraints', system.includes('overallScore'));
}

// ------- Test 2: User prompt contains PR context -------
console.log('\nTest 2: User prompt contains PR context');
{
  const messages = buildPrompt(makeRequest());
  const user = messages.find((m) => m.role === 'user')!.content;
  assert('contains PR title', user.includes('Add audio module'));
  assert('contains linked issue #42', user.includes('#42'));
  assert('contains linked issue title', user.includes('Audio recording bug'));
  assert('contains code patch filename', user.includes('src/main.ts'));
  assert('contains diff content', user.includes('const y = 2'));
  assert('contains language info', user.includes('TypeScript'));
  assert('contains framework info', user.includes('Probot'));
  assert('contains trigger source', user.includes('pr_opened'));
}

// ------- Test 3: Output JSON Schema is valid -------
console.log('\nTest 3: Output JSON Schema is valid');
{
  assert('has required properties', OUTPUT_SCHEMA.required.length > 0);
  assert('summary is required', OUTPUT_SCHEMA.required.includes('summary'));
  assert('risks is required', OUTPUT_SCHEMA.required.includes('risks'));
  assert('risk level enum correct', OUTPUT_SCHEMA.properties.risks.items.properties.level.enum.includes('critical'));
  assert('overallScore 0-10 range', OUTPUT_SCHEMA.properties.overallScore.maximum === 10);
  assert('confidence 0-1 range', OUTPUT_SCHEMA.properties.risks.items.properties.confidence.maximum === 1);
}

// ------- Test 4: Empty body / no linked issues handled -------
console.log('\nTest 4: Empty body / no linked issues handled');
{
  const req = makeRequest({
    body: '',
    context: { linkedIssues: [], language: undefined, framework: undefined },
  });
  const messages = buildPrompt(req);
  const user = messages.find((m) => m.role === 'user')!.content;
  assert('contains no-description placeholder', user.includes('无描述'));
  assert('contains no-issues placeholder', user.includes('无关联 Issue'));
  assert('language defaults to 未知', user.includes('未知'));
  assert('framework defaults to 无', user.includes('无'));
}

// ------- Test 5: Custom rules injected -------
console.log('\nTest 5: Custom rules injected');
{
  const customRules = [
    { name: 'no-eval', description: '禁止使用 eval() 函数', level: 'error' as const, pattern: '/eval\\s*\\(/' },
    { name: 'no-innerHTML', description: '避免直接使用 innerHTML', level: 'warn' as const, pattern: '/innerHTML/' },
  ];
  const messages = buildPrompt(makeRequest(), customRules);
  const system = messages.find((m) => m.role === 'system')!.content;
  const user = messages.find((m) => m.role === 'user')!.content;
  assert('system contains custom rules', system.includes('自定义审查规则'));
  assert('system contains no-eval rule', system.includes('禁止使用 eval()'));
  assert('system contains no-innerHTML', system.includes('innerHTML'));
  assert('user template contains custom rules', user.includes('禁止使用 eval()'));
}

// ------- Test 6: Template renderer handles array sections -------
console.log('\nTest 6: Template renderer handles sections correctly');
{
  // With linked issues
  const withIssues = makeRequest();
  const msgWith = buildPrompt(withIssues);
  const userWith = msgWith.find((m) => m.role === 'user')!.content;
  assert('linked issue rendered', userWith.includes('Audio recording bug'));
  assert('no inverted section fallback', !userWith.includes('（无关联 Issue）'));

  // Without linked issues
  const withoutIssues = makeRequest({ context: { linkedIssues: [] } });
  const msgWithout = buildPrompt(withoutIssues);
  const userWithout = msgWithout.find((m) => m.role === 'user')!.content;
  assert('inverted section shows fallback', userWithout.includes('（无关联 Issue）'));
}

// ------- Test 7: Language hint detection -------
console.log('\nTest 7: Language hint detection');
{
  const cases: [string | undefined, string][] = [
    ['TypeScript', 'typescript'],
    ['JavaScript', 'javascript'],
    ['Go', 'go'],
    ['Python', 'python'],
    ['Rust', 'rust'],
    ['Java', 'java'],
    ['Kotlin', 'kotlin'],
    ['Unknown', ''],
    [undefined, ''],
  ];
  for (const [input, expected] of cases) {
    const req = makeRequest({ context: { linkedIssues: [], language: input } });
    const messages = buildPrompt(req);
    const user = messages.find((m) => m.role === 'user')!.content;
    // languageHint is embedded in the patch blocks
    if (expected) {
      assert(`hint for ${input}`, user.includes('```' + expected));
    } else {
      assert(`no hint for ${input}`, user.includes('```\n'));
    }
  }
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
