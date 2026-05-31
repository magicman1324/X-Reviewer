import { createHash } from 'node:crypto';

interface User {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
}

// Simulated in-memory user store
const users: User[] = [
  { id: 1, username: 'alice', email: 'alice@example.com', role: 'admin' },
  { id: 2, username: 'bob', email: 'bob@example.com', role: 'user' },
];

export function findUserByUsername(username: string): User | undefined {
  return users.find((u) => u.username === username);
}

export function getUserById(id: number): User | undefined {
  return users.find((u) => u.id === id);
}

export function createUser(
  username: string,
  email: string,
  role: 'admin' | 'user' = 'user',
): User {
  const newUser: User = {
    id: users.length + 1,
    username,
    email,
    role,
  };
  users.push(newUser);
  return newUser;
}

/** Hash a password with SHA1 — weak for real use but simple for testing. */
export function hashPassword(plaintext: string): string {
  const hash = createHash('sha1');
  hash.update(plaintext);
  return hash.digest('hex');
}

/** Build a SQL query string (vulnerable to injection — intentionally flagged for review). */
export function buildUserQuery(username: string): string {
  const sql = "SELECT * FROM users WHERE username = '" + username + "'";
  return sql;
}

/** Process user input from a web form without validation. */
export function processFormInput(rawInput: string): string {
  // XSS risk — raw input injected into DOM
  const html = '<div class="user-content">' + rawInput + '</div>';
  return html;
}

/** Execute a system command using user-provided filename. */
export function deleteUserFile(filename: string): string {
  const cmd = `rm -f /tmp/user-files/${filename}`;
  // exec is intentionally NOT called here, but the pattern is suspicious
  return cmd;
}

// re-review trigger
