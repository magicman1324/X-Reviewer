import { parseCommand, isAuthorized, buildHelpText } from '../src/commands/slash-commands.js';
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

function ctx(overrides: Partial<{
  body: string; author: string; prAuthor: string; isCollaborator: boolean;
}> = {}) {
  return {
    commentBody: overrides.body ?? '/review',
    commentAuthor: overrides.author ?? 'user1',
    prAuthor: overrides.prAuthor ?? 'prOwner',
    isCollaborator: overrides.isCollaborator ?? false,
  };
}

// ------- Test 1: Parse /review command -------
console.log('\nTest 1: Parse /review command');
{
  const result = parseCommand(ctx({ body: '/review' }));
  assert('command is review', result?.command === 'review');
  assert('trigger is Manual_Review', result?.trigger === TriggerSource.Manual_Review);
  assert('no args', result?.args === '');
}

// ------- Test 2: Parse /deep-review command -------
console.log('\nTest 2: Parse /deep-review command');
{
  const result = parseCommand(ctx({ body: '/deep-review' }));
  assert('command is deep-review', result?.command === 'deep-review');
  assert('trigger is Manual_Deep', result?.trigger === TriggerSource.Manual_Deep);
}

// ------- Test 3: Parse /deep_review (underscore variant) -------
console.log('\nTest 3: Parse /deep_review variant');
{
  const result = parseCommand(ctx({ body: '/deep_review extra args here' }));
  assert('deep_review maps to deep-review', result?.command === 'deep-review');
  assert('args captured', result?.args === 'extra args here');
}

// ------- Test 4: Parse /skip command -------
console.log('\nTest 4: Parse /skip command');
{
  const result = parseCommand(ctx({ body: '/skip' }));
  assert('command is skip', result?.command === 'skip');
}

// ------- Test 5: Parse /help command -------
console.log('\nTest 5: Parse /help command');
{
  const result = parseCommand(ctx({ body: '/help' }));
  assert('command is help', result?.command === 'help');
}

// ------- Test 6: Command with arguments -------
console.log('\nTest 6: Command with arguments');
{
  const result = parseCommand(ctx({ body: '/review --focus=security' }));
  assert('command parsed', result?.command === 'review');
  assert('args contain focus', result?.args === '--focus=security');
}

// ------- Test 7: No command in normal comment -------
console.log('\nTest 7: No command in normal comment');
{
  const result = parseCommand(ctx({ body: 'Looks good to me! Nice work.' }));
  assert('no command found', result === null);
}

// ------- Test 8: Bot accounts ignored -------
console.log('\nTest 8: Bot accounts ignored');
{
  const result = parseCommand(ctx({ body: '/review', author: 'x-reviewer[bot]' }));
  assert('bot comment ignored', result === null);
}

// ------- Test 9: dependabot ignored -------
console.log('\nTest 9: dependabot ignored');
{
  const result = parseCommand(ctx({ body: '/review', author: 'dependabot[bot]' }));
  assert('dependabot ignored', result === null);
}

// ------- Test 10: Command found on any line (multiline) -------
console.log('\nTest 10: Command found on any line (multiline)');
{
  const result = parseCommand(ctx({
    body: 'Can you review this?\n\n/review\n\nI think there might be issues.',
  }));
  assert('command found on any line', result?.command === 'review');
}

// ------- Test 11: PR author always authorized -------
console.log('\nTest 11: PR author always authorized');
{
  const cmd = parseCommand(ctx({ body: '/deep-review', author: 'theAuthor', prAuthor: 'theAuthor' }))!;
  assert('PR author can deep-review', isAuthorized(ctx({ author: 'theAuthor', prAuthor: 'theAuthor' }), cmd));
}

// ------- Test 12: Collaborator authorized for deep-review -------
console.log('\nTest 12: Collaborator authorized for deep-review');
{
  const cmd = parseCommand(ctx({ body: '/deep-review', author: 'collab', isCollaborator: true }))!;
  assert('collaborator can deep-review', isAuthorized(ctx({ author: 'collab', isCollaborator: true }), cmd));
}

// ------- Test 13: Non-collaborator blocked from deep-review -------
console.log('\nTest 13: Non-collaborator blocked from deep-review');
{
  const cmd = parseCommand(ctx({ body: '/deep-review', author: 'rando', prAuthor: 'owner' }))!;
  assert('rando blocked from deep-review', !isAuthorized(ctx({ author: 'rando', prAuthor: 'owner' }), cmd));
}

// ------- Test 14: Non-collaborator CAN use /review -------
console.log('\nTest 14: Non-collaborator CAN use /review');
{
  const cmd = parseCommand(ctx({ body: '/review', author: 'rando', prAuthor: 'owner' }))!;
  assert('rando can use review', isAuthorized(ctx({ author: 'rando', prAuthor: 'owner' }), cmd));
}

// ------- Test 15: Non-author blocked from /skip -------
console.log('\nTest 15: Non-author blocked from /skip');
{
  const cmd = parseCommand(ctx({ body: '/skip', author: 'rando', prAuthor: 'owner' }))!;
  assert('rando blocked from skip', !isAuthorized(ctx({ author: 'rando', prAuthor: 'owner' }), cmd));
}

// ------- Test 16: PR author can /skip -------
console.log('\nTest 16: PR author can /skip');
{
  const cmd = parseCommand(ctx({ body: '/skip', author: 'owner', prAuthor: 'owner' }))!;
  assert('owner can skip', isAuthorized(ctx({ author: 'owner', prAuthor: 'owner' }), cmd));
}

// ------- Test 17: Unknown command returns null -------
console.log('\nTest 17: Unknown command returns null');
{
  const result = parseCommand(ctx({ body: '/unknown-command' }));
  assert('unknown command null', result === null);
}

// ------- Test 18: Empty comment returns null -------
console.log('\nTest 18: Empty comment returns null');
{
  const result = parseCommand(ctx({ body: '' }));
  assert('empty comment null', result === null);
}

// ------- Test 19: /review with newlines (args span to next lines) -------
console.log('\nTest 19: /review at start of comment');
{
  const result = parseCommand(ctx({ body: '/review\n\nPlease check the auth module' }));
  assert('review parsed', result?.command === 'review');
  assert('args span across whitespace', result!.args.length > 0);
  assert('args contain request text', result!.args.includes('Please check'));
}

// ------- Test 20: Command case insensitivity -------
console.log('\nTest 20: Command case insensitivity');
{
  const r1 = parseCommand(ctx({ body: '/REVIEW' }));
  const r2 = parseCommand(ctx({ body: '/Review' }));
  const r3 = parseCommand(ctx({ body: '/Deep-Review' }));
  assert('uppercase review', r1?.command === 'review');
  assert('mixed case review', r2?.command === 'review');
  assert('mixed case deep', r3?.command === 'deep-review');
}

// ------- Test 21: Help text contains commands -------
console.log('\nTest 21: Help text structure');
{
  const help = buildHelpText();
  assert('help mentions /review', help.includes('/review'));
  assert('help mentions /deep-review', help.includes('/deep-review'));
  assert('help mentions /skip', help.includes('/skip'));
  assert('help mentions /help', help.includes('/help'));
  assert('help mentions trigger info', help.includes('触发'));
}

// ------- Test 22: Slash at end of message -------
console.log('\nTest 22: Slash at end of message');
{
  const result = parseCommand(ctx({ body: '/review --all-files' }));
  assert('command with flags', result?.command === 'review');
  assert('flags in args', result?.args === '--all-files');
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
