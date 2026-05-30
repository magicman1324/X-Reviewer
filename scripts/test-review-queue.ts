import { ReviewQueue, buildDedupeKey } from '../src/queue/review-queue.js';
import { QueueJobStatus, TriggerSource, type ReviewRequest, type FilteredDiff } from '../src/types/index.js';

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
  const diff: FilteredDiff = { raw: '', businessPatches: [], noiseFiles: [] };
  return {
    owner: 'test', repo: 'test', prNumber: 1,
    title: 'Test', body: '',
    headSha: 'abc', baseSha: 'def',
    files: [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, isNoise: false }],
    diff,
    context: { linkedIssues: [] },
    trigger: TriggerSource.PR_Opened,
    ...overrides,
  };
}

// ------- Test 1: Enqueue and process a job -------
console.log('\nTest 1: Enqueue and process a job');
{
  const queue = new ReviewQueue(2);
  const processed: string[] = [];

  queue.process(async (job) => {
    processed.push(job.id);
  });

  const id = await queue.add(makeRequest(), 1);

  // Wait for async processing
  await new Promise((r) => setTimeout(r, 100));

  assert('job was processed', processed.length === 1);
  assert('job id matches', processed[0] === id);
}

// ------- Test 2: Retry with exponential backoff -------
console.log('\nTest 2: Retry with exponential backoff');
{
  const queue2 = new ReviewQueue(1, { maxAttempts: 3, backoffBaseMs: 10, backoffMaxMs: 50 });
  const retryEvents: number[] = [];
  let attempts = 0;

  queue2.process(async (_job) => {
    attempts++;
    if (attempts < 3) throw new Error('Temporary failure');
  });

  queue2.on('retrying', (_job, delay) => {
    retryEvents.push(delay);
  });

  const completed = new Promise<boolean>((resolve) => {
    queue2.on('completed', () => resolve(true));
    queue2.on('failed', () => resolve(false));
  });

  await queue2.add(makeRequest(), 2);

  const result = await Promise.race([completed, new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);

  assert('job eventually completed', result === true);
  assert('2 retry events', retryEvents.length === 2);
  assert('backoff increases', retryEvents.length >= 2 ? retryEvents[1] > retryEvents[0] : true);
}

// ------- Test 3: Job fails after max retries → dead letter -------
console.log('\nTest 3: Max retries → dead letter');
{
  const queue3 = new ReviewQueue(1, { maxAttempts: 2, backoffBaseMs: 5, backoffMaxMs: 20 });

  queue3.process(async () => {
    throw new Error('Always fails');
  });

  const failedId = await new Promise<string>((resolve) => {
    queue3.on('failed', (job) => resolve(job.id));
    queue3.add(makeRequest({ headSha: 'fail-sha' }), 3);
  });

  const deadJob = queue3.getJob(failedId);
  assert('job in dead letter', deadJob !== undefined);
  assert('dead job status is Failed', deadJob?.status === QueueJobStatus.Failed);
  assert('dead job has error', deadJob?.lastError?.includes('Always fails'));
  assert('dead job attempts = 2', deadJob?.attempts === 2);
}

// ------- Test 4: Deduplication by key -------
console.log('\nTest 4: Deduplication');
{
  const queue4 = new ReviewQueue(1);
  const processed: string[] = [];

  queue4.process(async (job) => {
    processed.push(job.id);
  });

  const req = makeRequest({ headSha: 'same-sha' });
  const id1 = await queue4.add(req, 10);
  const id2 = await queue4.add(req, 11); // Same request → deduped
  const id3 = await queue4.add(makeRequest({ headSha: 'other-sha' }), 12);

  await new Promise((r) => setTimeout(r, 100));

  assert('same dedupe key', id1 === id2);
  assert('different key for diff sha', id1 !== id3);
  assert('only 2 processed (1 deduped)', processed.length === 2);
}

// ------- Test 5: buildDedupeKey includes noise filter -------
console.log('\nTest 5: Dedupe key filters noise files');
{
  const req1 = makeRequest({
    headSha: 'sha1',
    files: [
      { filename: 'src/foo.ts', status: 'modified', additions: 1, deletions: 0, isNoise: false },
      { filename: 'package-lock.json', status: 'modified', additions: 10, deletions: 0, isNoise: true },
    ],
  });
  const req2 = makeRequest({
    headSha: 'sha1',
    files: [
      { filename: 'src/foo.ts', status: 'modified', additions: 1, deletions: 0, isNoise: false },
      { filename: 'yarn.lock', status: 'modified', additions: 10, deletions: 0, isNoise: true },
    ],
  });

  assert('same key despite diff noise files', buildDedupeKey(req1) === buildDedupeKey(req2));
}

// ------- Test 6: Queue stats for health check -------
console.log('\nTest 6: Queue stats');
{
  const queue6 = new ReviewQueue(1);

  const req = makeRequest();
  await queue6.add(req, 20);
  await new Promise((r) => setTimeout(r, 50));

  const stats = queue6.getStats();
  assert('stats has pending count', 'pending' in stats);
  assert('stats has active count', 'active' in stats);
  assert('stats has dead count', 'dead' in stats);
}

// ------- Test 7: Concurrency limit respected -------
console.log('\nTest 7: Concurrency limit');
{
  const queue7 = new ReviewQueue(2); // Max 2 concurrent
  let maxConcurrent = 0;
  let current = 0;

  queue7.process(async (_job) => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await new Promise((r) => setTimeout(r, 50));
    current--;
  });

  for (let i = 0; i < 5; i++) {
    await queue7.add(makeRequest({ prNumber: i, headSha: `sha-${i}` }), i + 30);
  }

  await new Promise((r) => setTimeout(r, 400));

  assert('max concurrent ≤ 2', maxConcurrent <= 2);
  assert('at least 2 concurrent at some point', maxConcurrent >= 2);
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
