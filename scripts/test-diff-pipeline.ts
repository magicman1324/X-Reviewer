import { runDiffPipeline } from '../src/services/diff-pipeline.js';
import type { ChangedFile } from '../src/types/index.js';

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

function makeFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    filename: 'src/foo.ts',
    status: 'modified',
    patch: '',
    additions: 1,
    deletions: 0,
    isNoise: false,
    ...overrides,
  };
}

// ------- Test 1: Lock files filtered -------
console.log('\nTest 1: Lock files filtered');
{
  const result = runDiffPipeline([
    makeFile({ filename: 'package-lock.json', patch: '+  "version": "2.0"', additions: 50 }),
    makeFile({
      filename: 'src/main.ts',
      patch: '@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n return x;',
      additions: 1,
    }),
  ]);
  assert('package-lock.json is marked noise', result.noiseFiles.includes('package-lock.json'));
  assert('src/main.ts in business', result.businessPatches.some((p) => p.filename === 'src/main.ts'));
}

// ------- Test 2: Binary/image files filtered -------
console.log('\nTest 2: Binary/image files filtered');
{
  const result = runDiffPipeline([
    makeFile({ filename: 'assets/logo.png' }),
    makeFile({ filename: 'data/dump.zip' }),
    makeFile({
      filename: 'src/app.ts',
      patch: '@@ -1,2 +1,3 @@\n-const a = 1;\n+const a = 2;\n',
      additions: 1,
      deletions: 1,
    }),
  ]);
  assert('png is noise', result.noiseFiles.includes('assets/logo.png'));
  assert('zip is noise', result.noiseFiles.includes('data/dump.zip'));
  assert('app.ts is in business', result.businessPatches.some((p) => p.filename === 'src/app.ts'));
}

// ------- Test 3: Only +/- lines with context extracted -------
console.log('\nTest 3: Only +/- lines with context extracted');
{
  const diff = `@@ -10,6 +10,8 @@ function init() {
   setupDb();
   loadConfig();
+  validateEnv();
+  initRedis();
   startServer();
 }`;
  const result = runDiffPipeline([
    makeFile({ filename: 'src/init.ts', patch: diff, additions: 2 }),
  ]);
  assert('business patch contains validateEnv', result.businessPatches[0].patch.includes('validateEnv'));
  assert('business patch contains initRedis', result.businessPatches[0].patch.includes('initRedis'));
  assert('business patch contains context lines', result.businessPatches[0].patch.includes('setupDb'));
}

// ------- Test 4: Format-only changes filtered -------
console.log('\nTest 4: Format-only changes filtered');
{
  const diff = `@@ -1,3 +1,3 @@
-  // old comment
+  // updated comment
   const x = 1;`;
  const result = runDiffPipeline([makeFile({ filename: 'src/comments.ts', patch: diff })]);
  assert('format-only patch is noise', result.noiseFiles.includes('src/comments.ts'));
  assert('no business patches', result.businessPatches.length === 0);
}

// ------- Test 5: Large diff truncation by priority -------
console.log('\nTest 5: Large diff truncation by priority');
{
  const bigPatch =
    '@@ -1,5 +1,6 @@\n-a\n+b\n'.repeat(2000); // ~8000 chars, ~2000 tokens
  const result = runDiffPipeline(
    [
      makeFile({ filename: 'docs/README.md', patch: bigPatch }),
      makeFile({ filename: 'src/core.ts', patch: bigPatch }),
    ],
    1000, // small budget
  );
  assert('.ts file prioritized over .md', result.businessPatches[0].filename === 'src/core.ts');
}

// ------- Test 6: Import-only changes filtered -------
console.log('\nTest 6: Import-only changes filtered');
{
  const diff = `@@ -1,2 +1,3 @@
-import { foo } from './a';
+import { foo } from './a';
+import { bar } from './b';`;
  const result = runDiffPipeline([makeFile({ filename: 'src/imports.ts', patch: diff })]);
  assert('import-only patch is noise', result.noiseFiles.includes('src/imports.ts'));
}

// ------- Summary -------
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
