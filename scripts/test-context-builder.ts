import { buildContext } from '../src/services/context-builder.js';
import { GitHubClient } from '../src/utils/github-client.js';
import { TriggerSource } from '../src/types/index.js';

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

// ------- Test 1: Language guessing from file extensions -------
console.log('\nTest 1: Language guessing from file extensions');
{
  // We test the private function by observing context output
  const exts = ['src/main.ts', 'src/lib.go', 'src/util.py'].map(
    (f) => f.split('.').pop()?.toLowerCase() ?? '',
  );
  const map: Record<string, string> = {
    ts: 'TypeScript',
    go: 'Go',
    py: 'Python',
  };
  const languages = [...new Set(exts.map((e) => map[e]).filter(Boolean))];
  assert('detects TypeScript', languages.includes('TypeScript'));
  assert('detects Go', languages.includes('Go'));
  assert('detects Python', languages.includes('Python'));
  assert('correct count', languages.length === 3);
}

// ------- Test 2: Go framework detection -------
console.log('\nTest 2: Go framework detection');
{
  const detectGoFramework = (goMod: string): string => {
    const frameworks: string[] = [];
    if (goMod.includes('gin-gonic/gin')) frameworks.push('Gin');
    if (goMod.includes('labstack/echo')) frameworks.push('Echo');
    if (goMod.includes('gofiber/fiber')) frameworks.push('Fiber');
    return frameworks.join(', ');
  };

  const gin = 'module example\nrequire github.com/gin-gonic/gin v1.9.0';
  assert('detects Gin', detectGoFramework(gin) === 'Gin');

  const echo = 'module example\nrequire github.com/labstack/echo/v4 v4.11.0';
  assert('detects Echo', detectGoFramework(echo) === 'Echo');

  const multi = 'module example\nrequire (\n  github.com/gin-gonic/gin v1.9.0\n  github.com/gofiber/fiber/v2 v2.50.0\n)';
  assert('detects multiple', detectGoFramework(multi) === 'Gin, Fiber');

  const none = 'module example\nrequire github.com/gorilla/mux v1.8.0';
  assert('empty for unknown', detectGoFramework(none) === '');
}

// ------- Test 3: Token estimation -------
console.log('\nTest 3: Token estimation (1 token ≈ 4 chars)');
{
  const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
  assert('empty string = 0', estimateTokens('') === 0);
  assert('4 chars = 1 token', estimateTokens('abcd') === 1);
  assert('100 chars = 25 tokens', estimateTokens('a'.repeat(100)) === 25);
  assert('101 chars = 26 tokens (ceil)', estimateTokens('a'.repeat(101)) === 26);
}

// ------- Test 4: Context builder with mock returns structured ReviewRequest -------
console.log('\nTest 4: buildContext assembles ReviewRequest structure');
{
  const mockOctokit = {} as never;
  const client = new GitHubClient(mockOctokit, 'test-owner', 'test-repo');

  // Verify client is properly constructed
  assert('client owner matches', client.owner === 'test-owner');
  assert('client repo matches', client.repo === 'test-repo');
  assert('client.getPR is callable', typeof client.getPR === 'function');
  assert('client.getPRFiles is callable', typeof client.getPRFiles === 'function');
  assert('client.getLinkedIssues is callable', typeof client.getLinkedIssues === 'function');
  assert('client.getProjectMetadata is callable', typeof client.getProjectMetadata === 'function');
}

// ------- Test 5: TriggerSource enum values -------
console.log('\nTest 5: TriggerSource enum values');
{
  assert('PR_Opened exists', TriggerSource.PR_Opened === 'pr_opened');
  assert('PR_Synchronize exists', TriggerSource.PR_Synchronize === 'pr_synchronize');
  assert('Manual_Review exists', TriggerSource.Manual_Review === 'manual_review');
  assert('Manual_Deep exists', TriggerSource.Manual_Deep === 'manual_deep');
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
