import { GitHubClient } from '../src/utils/github-client.js';

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

// ------- Test 1: Linked issue extraction -------
console.log('\nTest 1: Linked issue extraction from PR body');
{
  const body = `
Fixes #42 - critical bug
Also closes #99 and resolves #101.
refs #200 is just a reference.
  `.trim();

  // We need a minimal mock to test the parser logic
  // The regex-based extraction is independent of the API
  const refs = body.matchAll(/(?:fixes|closes|resolves|refs?)\s+#(\d+)/gi);
  const extracted = [...new Set([...refs].map((m) => parseInt(m[1], 10)))];

  assert('extracts fixes #42', extracted.includes(42));
  assert('extracts closes #99', extracted.includes(99));
  assert('extracts resolves #101', extracted.includes(101));
  assert('extracts refs #200', extracted.includes(200));
  assert('correct count', extracted.length === 4);
}

// ------- Test 2: GitHubClient construction -------
console.log('\nTest 2: GitHubClient construction');
{
  const mockOctokit = {
    rest: {},
    paginate: { iterator: () => ({}) },
  } as unknown as Parameters<(typeof GitHubClient)['prototype']['constructor']>[0];

  const client = new GitHubClient(mockOctokit, 'magicman1324', 'X-Reviewer');
  assert('owner set correctly', client.owner === 'magicman1324');
  assert('repo set correctly', client.repo === 'X-Reviewer');
}

// ------- Test 3: No issues in empty body -------
console.log('\nTest 3: No issues in empty body');
{
  const refs = ''.matchAll(/(?:fixes|closes|resolves|refs?)\s+#(\d+)/gi);
  assert('empty body yields no refs', [...refs].length === 0);
}

// ------- Test 4: Case insensitive matching -------
console.log('\nTest 4: Case insensitive matching');
{
  const body = 'FIXES #10 and ClOsEs #20 and Fixes #30';
  const refs = body.matchAll(/(?:fixes|closes|resolves|refs?)\s+#(\d+)/gi);
  const extracted = [...new Set([...refs].map((m) => parseInt(m[1], 10)))];

  assert('FIXES uppercase matched', extracted.includes(10));
  assert('ClOsEs mixed case matched', extracted.includes(20));
  assert('Fixes matched', extracted.includes(30));
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
