import { RateLimiter, detectAbuse, RateLimitPresets } from '../src/services/rate-limiter.js';

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

// ------- Test 1: Allow requests within limit -------
console.log('\nTest 1: Allow requests within limit');
{
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
  const results = Array.from({ length: 3 }, () => limiter.check('user-a'));
  assert('all 3 allowed', results.every((r) => r.allowed));
  assert('remaining decreases', results[2].remaining === 2);
}

// ------- Test 2: Block after max reached -------
console.log('\nTest 2: Block after max reached');
{
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000, cooldownMs: 1000 });
  limiter.check('user-b');
  limiter.check('user-b');
  const blocked = limiter.check('user-b');
  assert('3rd request blocked', !blocked.allowed);
  assert('reason mentions rate limit', blocked.reason?.includes('Rate limit exceeded'));
  assert('remaining is 0', blocked.remaining === 0);
}

// ------- Test 3: Min interval enforced -------
console.log('\nTest 3: Min interval enforced');
{
  const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000, minIntervalMs: 5000 });
  limiter.check('user-c');
  const tooSoon = limiter.check('user-c');
  assert('too soon blocked', !tooSoon.allowed);
  assert('reason mentions frequent', tooSoon.reason?.includes('Too frequent'));
}

// ------- Test 4: Different keys independent -------
console.log('\nTest 4: Different keys independent');
{
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 });
  limiter.check('user-x');
  limiter.check('user-x');
  const blockedX = limiter.check('user-x');
  const allowedY = limiter.check('user-y');
  assert('user-x blocked', !blockedX.allowed);
  assert('user-y allowed', allowedY.allowed);
}

// ------- Test 5: Cooldown enforced -------
console.log('\nTest 5: Cooldown enforced');
{
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000, cooldownMs: 20000 });
  for (let i = 0; i < 3; i++) limiter.check('user-d'); // 3rd triggers cooldown
  const duringCooldown = limiter.check('user-d');
  assert('blocked during cooldown', !duringCooldown.allowed);
  assert('cooldown reason', duringCooldown.reason?.includes('Cooldown'));
}

// ------- Test 6: Reset clears bucket -------
console.log('\nTest 6: Reset clears bucket');
{
  const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000 });
  limiter.check('user-e');
  limiter.reset('user-e');
  const afterReset = limiter.check('user-e');
  assert('allowed after reset', afterReset.allowed);
}

// ------- Test 7: Stats reporting -------
console.log('\nTest 7: Stats reporting');
{
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
  limiter.check('stats-1');
  limiter.check('stats-2');
  const stats = limiter.getStats();
  assert('has active buckets', stats.activeBuckets >= 2);
  assert('total requests = 2', stats.totalRequests === 2);
  assert('cooldown buckets reported', typeof stats.cooldownBuckets === 'number');
}

// ------- Test 8: Spam detection in PR body -------
console.log('\nTest 8: Spam detection');
{
  const flags = detectAbuse({
    prBody: 'Buy cheap viagra now! Click here: https://spam.com/click',
    prTitle: 'Fix bug',
    fileCount: 3,
    totalChanges: 50,
  });
  assert('spam detected', flags.some((f) => f.includes('Spam')));
}

// ------- Test 9: Script tag in PR = abuse -------
console.log('\nTest 9: Script tag in PR body');
{
  const flags = detectAbuse({
    prBody: 'Check this <script>alert(1)</script> out',
    prTitle: 'Update',
    fileCount: 1,
    totalChanges: 10,
  });
  assert('script tag flagged', flags.some((f) => f.includes('Spam')));
}

// ------- Test 10: Suspicious file count -------
console.log('\nTest 10: Suspicious file count');
{
  const flags = detectAbuse({
    prBody: 'Normal PR description.',
    prTitle: 'Refactor',
    fileCount: 600,
    totalChanges: 50,
  });
  assert('large file count flagged', flags.some((f) => f.includes('file count')));
}

// ------- Test 11: Suspicious change volume -------
console.log('\nTest 11: Suspicious change volume');
{
  const flags = detectAbuse({
    prBody: 'Normal description.',
    prTitle: 'Massive update',
    fileCount: 10,
    totalChanges: 15000,
  });
  assert('large change volume flagged', flags.some((f) => f.includes('change volume')));
}

// ------- Test 12: PR body is just a URL -------
console.log('\nTest 12: PR body is a single URL');
{
  const flags = detectAbuse({
    prBody: 'https://evil-site.com/malware',
    prTitle: 'Important fix',
    fileCount: 2,
    totalChanges: 20,
  });
  assert('single URL flagged', flags.some((f) => f.includes('single URL')));
}

// ------- Test 13: Empty body with large diff -------
console.log('\nTest 13: Empty body with large diff');
{
  const flags = detectAbuse({
    prBody: '',
    prTitle: 'Changes',
    fileCount: 5,
    totalChanges: 3000,
  });
  assert('empty body large diff flagged', flags.some((f) => f.includes('Empty PR body')));
}

// ------- Test 14: Clean PR not flagged -------
console.log('\nTest 14: Clean PR not flagged');
{
  const flags = detectAbuse({
    prBody: 'This PR adds the new authentication middleware and fixes #42.',
    prTitle: 'Add auth middleware',
    fileCount: 5,
    totalChanges: 200,
  });
  assert('clean PR has no flags', flags.length === 0);
}

// ------- Test 15: Presets have expected values -------
console.log('\nTest 15: Rate limit presets');
{
  const userPreset = RateLimitPresets.user();
  assert('user preset maxRequests', userPreset.maxRequests === 10);
  assert('user preset windowMs', userPreset.windowMs === 10 * 60 * 1000);
  assert('user preset minInterval', userPreset.minIntervalMs === 5000);

  const deepPreset = RateLimitPresets.deepReview();
  assert('deep maxRequests is stricter', deepPreset.maxRequests < userPreset.maxRequests);
  assert('deep windowMs is larger', deepPreset.windowMs > userPreset.windowMs);

  const repoPreset = RateLimitPresets.repo();
  assert('repo maxRequests higher', repoPreset.maxRequests > userPreset.maxRequests);
}

// ------- Test 16: Casino keyword detection -------
console.log('\nTest 16: Casino keyword detection');
{
  const flags = detectAbuse({
    prBody: 'Win big at our online casino! Free lottery prize!',
    prTitle: 'Great offer',
    fileCount: 1,
    totalChanges: 1,
  });
  assert('casino spam detected', flags.some((f) => f.includes('Spam')));
}

// ------- Test 17: RetryAfterMs set for blocked requests -------
console.log('\nTest 17: RetryAfterMs for blocked requests');
{
  const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000, cooldownMs: 30000 });
  limiter.check('user-f'); // consume the 1
  const blocked = limiter.check('user-f');
  assert('retryAfterMs > 0', (blocked.retryAfterMs ?? 0) > 0);
}

// ------- Test 18: Multiple abuse flags can coexist -------
console.log('\nTest 18: Multiple abuse flags');
{
  const flags = detectAbuse({
    prBody: 'https://spammy-site.com/free-stuff',
    prTitle: 'Update',
    fileCount: 600,
    totalChanges: 5,
  });
  assert('multiple flags returned', flags.length >= 2);
}

// ------- Test 19: retryAfter for min interval violation -------
console.log('\nTest 19: retryAfter for min interval');
{
  const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000, minIntervalMs: 10000 });
  limiter.check('user-g');
  const blocked = limiter.check('user-g');
  assert('retryAfterMs for interval', (blocked.retryAfterMs ?? 0) > 0);
  assert('retryAfter < minIntervalMs', (blocked.retryAfterMs ?? 0) <= 10000);
}

// ------- Test 20: cooldown after hitting limit -------
console.log('\nTest 20: RetryAfter for cooldown');
{
  const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000, cooldownMs: 15000 });
  limiter.check('user-h');
  const blocked = limiter.check('user-h');
  assert('cooldown retryAfter', (blocked.retryAfterMs ?? 0) >= 15000);
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
