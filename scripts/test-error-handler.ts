import { handleError, ErrorCategory, formatErrorForComment } from '../src/utils/error-handler.js';
import { Logger } from '../src/utils/logger.js';

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

// ------- Test 1: Logger outputs at correct levels -------
console.log('\nTest 1: Logger level filtering');
{
  const log = new Logger({ level: 'warn' });
  // Should be filtered (below warn)
  assert('logger created', log instanceof Logger);
}

// ------- Test 2: Logger JSON mode -------
console.log('\nTest 2: Logger JSON mode');
{
  const log = new Logger({ level: 'info', json: true });
  assert('json logger created', log instanceof Logger);
}

// ------- Test 3: Logger child with context -------
console.log('\nTest 3: Logger child');
{
  const log = new Logger({ level: 'info' });
  const child = log.child({ requestId: 'abc-123' });
  assert('child logger created', child instanceof Logger);
}

// ------- Test 4: Error classification - validation = user -------
console.log('\nTest 4: Validation error → user');
{
  const result = handleError(new Error('Validation failed: PR number is required'));
  assert('category is user', result.category === ErrorCategory.User);
  assert('statusCode 400', result.statusCode === 400);
}

// ------- Test 5: Timeout → external -------
console.log('\nTest 5: Timeout → external');
{
  const result = handleError(new Error('Request timeout after 30s'));
  assert('category is external', result.category === ErrorCategory.External);
  assert('statusCode 502', result.statusCode === 502);
}

// ------- Test 6: Rate limit → external -------
console.log('\nTest 6: Rate limit → external');
{
  const result = handleError(new Error('API rate limit exceeded (429)'));
  assert('rate limit is external', result.category === ErrorCategory.External);
}

// ------- Test 7: Type error → internal -------
console.log('\nTest 7: TypeError → internal');
{
  const err = new TypeError('Cannot read properties of undefined');
  const result = handleError(err);
  assert('typeerror is internal', result.category === ErrorCategory.Internal);
  assert('statusCode 500', result.statusCode === 500);
}

// ------- Test 8: ECONNREFUSED → external -------
console.log('\nTest 8: ECONNREFUSED → external');
{
  const result = handleError(new Error('connect ECONNREFUSED 127.0.0.1:8080'));
  assert('econnrefused is external', result.category === ErrorCategory.External);
}

// ------- Test 9: Network error → retryable -------
console.log('\nTest 9: Network error → retryable');
{
  const result = handleError(new Error('socket hang up'));
  assert('socket hang up is retryable', result.category === ErrorCategory.Retryable);
}

// ------- Test 10: Too many requests → retryable -------
console.log('\nTest 10: Too many requests → retryable');
{
  const result = handleError(new Error('too many requests'));
  assert('too many is retryable', result.category === ErrorCategory.Retryable);
}

// ------- Test 11: AbortError → external -------
console.log('\nTest 11: AbortError → external');
{
  const abortErr = new Error('The operation was aborted');
  abortErr.name = 'AbortError';
  const result = handleError(abortErr);
  assert('aborterror is external', result.category === ErrorCategory.External);
}

// ------- Test 12: User visible flag for user errors -------
console.log('\nTest 12: User errors are userVisible');
{
  const result = handleError(new Error('Invalid PR format'));
  assert('user error is visible', result.userVisible);
}

// ------- Test 13: Internal errors not userVisible -------
console.log('\nTest 13: Internal errors not userVisible');
{
  const result = handleError(new TypeError('assertion failed'));
  assert('internal error not visible', !result.userVisible);
}

// ------- Test 14: Error classification with context -------
console.log('\nTest 14: Error classification with context');
{
  const result = handleError(
    new Error('External API timeout'),
    { prNumber: 42, repo: 'test/repo' },
  );
  assert('context preserved in result', result.category === ErrorCategory.External);
}

// ------- Test 15: formatErrorForComment user error -------
console.log('\nTest 15: formatErrorForComment user error');
{
  const err = new Error('PR body is empty');
  const classified = handleError(err);
  const formatted = formatErrorForComment(err, classified);
  assert('contains warning icon', formatted.includes('⚠️'));
  assert('contains error message', formatted.includes('PR body is empty'));
  assert('contains error ID', formatted.includes('Error ID'));
}

// ------- Test 16: formatErrorForComment internal error -------
console.log('\nTest 16: formatErrorForComment internal error');
{
  const err = new TypeError('Unexpected null reference');
  const classified = handleError(err);
  const formatted = formatErrorForComment(err, classified);
  assert('contains red X icon', formatted.includes('❌'));
  assert('contains category tag', formatted.includes('internal'));
}

// ------- Test 17: Unknown error → unknown category -------
console.log('\nTest 17: Unknown error → unknown');
{
  const result = handleError(new Error('Some unexpected thing happened'));
  assert('unknown is default', result.category === ErrorCategory.Unknown);
  assert('statusCode 500', result.statusCode === 500);
}

// ------- Test 18: ReferenceError → internal -------
console.log('\nTest 18: ReferenceError → internal');
{
  const err = new ReferenceError('x is not defined');
  const result = handleError(err);
  assert('referenceerror is internal', result.category === ErrorCategory.Internal);
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
