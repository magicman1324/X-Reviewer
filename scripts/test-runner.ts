import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

const files = readdirSync(SCRIPTS_DIR)
  .filter((f) => f.startsWith('test-') && f.endsWith('.ts') && f !== 'test-runner.ts')
  .sort();

console.log(`\nRunning ${files.length} test suites...\n`);

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const file of files) {
  const label = file.replace(/^test-|\.ts$/g, '').replace(/-/g, ' ');
  const absPath = join(SCRIPTS_DIR, file);

  const result = spawnSync('npx', ['tsx', absPath], {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 30_000,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.log(`  ✗ ${label} (spawn error: ${result.error.message})`);
    failed++;
    failures.push(file);
    continue;
  }

  const ok = result.status === 0;

  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const code = result.status !== null ? `exit ${result.status}` : `signal ${result.signal}`;
    console.log(`  ✗ ${label} (${code})`);
    failed++;
    failures.push(file);

    const out = (result.stdout ?? '').trimEnd();
    const err = (result.stderr ?? '').trimEnd();
    const tail = (err || out).split('\n').slice(-5).join('\n');
    if (tail) console.log(`    ${tail.replace(/\n/g, '\n    ')}`);
  }
}

console.log(`\n${'='.repeat(40)}`);
console.log(`  Passed:  ${passed}/${files.length}`);
console.log(`  Failed:  ${failed}/${files.length}`);
if (failures.length) console.log(`  Files:   ${failures.join(', ')}`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
