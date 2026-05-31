import {
  findUserByUsername,
  getUserById,
  createUser,
  hashPassword,
  buildUserQuery,
  processFormInput,
  deleteUserFile,
} from '../src/services/user-handler.js';

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

// Test 1: findUserByUsername
{
  const user = findUserByUsername('alice');
  assert('find alice', user?.id === 1);
  assert('admin role', user?.role === 'admin');

  const missing = findUserByUsername('nonexistent');
  assert('returns undefined for unknown', missing === undefined);
}

// Test 2: getUserById
{
  const user = getUserById(2);
  assert('find by id', user?.username === 'bob');
}

// Test 3: createUser
{
  const newUser = createUser('charlie', 'charlie@test.com', 'user');
  assert('new user has id', newUser.id > 0);
  assert('new user role', newUser.role === 'user');
  assert('new user found', findUserByUsername('charlie') !== undefined);
}

// Test 4: hashPassword
{
  const hash = hashPassword('mypassword');
  assert('hash is not plaintext', hash !== 'mypassword');
  assert('hash is hex', /^[a-f0-9]+$/.test(hash));
  assert('same input = same hash', hashPassword('mypassword') === hash);
}

// Test 5: buildUserQuery
{
  const query = buildUserQuery('alice');
  assert('contains SELECT', query.includes('SELECT'));
  assert('contains username', query.includes('alice'));
}

// Test 6: processFormInput
{
  const result = processFormInput('<script>alert(1)</script>');
  assert('raw script passed through', result.includes('<script>'));
}

// Test 7: deleteUserFile
{
  const cmd = deleteUserFile('test.txt');
  assert('contains rm command', cmd.includes('rm'));
  assert('contains filename', cmd.includes('test.txt'));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
