import type { ChangedFile, FilePatch, FilteredDiff } from '../types/index.js';

// ---- Noise file patterns ----

const NOISE_PATTERNS = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^bun\.lockb$/,
  /^Gemfile\.lock$/,
  /^Cargo\.lock$/,
  /^poetry\.lock$/,
  /^composer\.lock$/,
  /\.lock$/,
];

const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.ico',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.mp3',
  '.wav',
  '.ogg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.bin',
]);

const GENERATED_INDICATORS = [/\/generated\//i, /\.generated\./, /\.min\.(js|css)$/];

// ---- Format-only / comment-only pattern ----

const FORMAT_ONLY_RE = /^(\s*\/\/|\s*\*|\s*\/\*|\s*#)\s/;

const IMPORT_ONLY_RE = /^import\s/;

// ---- Business file priority (higher = kept first under truncation) ----

const FILE_PRIORITY: Record<string, number> = {
  '.ts': 100,
  '.tsx': 100,
  '.js': 90,
  '.jsx': 90,
  '.go': 95,
  '.py': 95,
  '.rs': 95,
  '.java': 85,
  '.kt': 85,
  '.swift': 80,
  '.c': 80,
  '.h': 80,
  '.cpp': 80,
  '.yml': 50,
  '.yaml': 50,
  '.json': 30,
  '.md': 20,
  '.txt': 10,
};

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i).toLowerCase();
}

function isNoiseFile(filename: string): boolean {
  const base = filename.split('/').pop() ?? filename;

  if (NOISE_PATTERNS.some((p) => p.test(base))) return true;
  if (BINARY_EXTS.has(getExt(filename))) return true;
  if (GENERATED_INDICATORS.some((p) => p.test(filename))) return true;

  return false;
}

function isFormatOnly(patch: string): boolean {
  const lines = patch.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-'));
  if (lines.length === 0) return true;
  return lines.every((l) => FORMAT_ONLY_RE.test(l.slice(1).trimStart()));
}

function isImportOnly(patch: string): boolean {
  const lines = patch.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-'));
  if (lines.length === 0) return true;
  return lines.every((l) => {
    const code = l.slice(1).trimStart();
    return IMPORT_ONLY_RE.test(code) || code === '' || code === '}' || code === '{';
  });
}

function extractBusinessLines(patch: string): string {
  const lines = patch.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Always keep hunk headers (@@ ... @@)
    if (line.startsWith('@@')) {
      result.push(line);
      continue;
    }

    // Keep changed lines (+/-) and 3 lines of context before/after
    if (line.startsWith('+') || line.startsWith('-')) {
      // Add up to 3 context lines before
      const start = Math.max(0, i - 3);
      for (let j = start; j < i; j++) {
        if (!result.includes(lines[j]) && !lines[j].startsWith('+') && !lines[j].startsWith('-')) {
          result.push(lines[j]);
        }
      }
      result.push(line);
      // Add up to 3 context lines after
      const end = Math.min(lines.length, i + 4);
      for (let j = i + 1; j < end; j++) {
        if (!lines[j].startsWith('+') && !lines[j].startsWith('-')) {
          result.push(lines[j]);
        }
      }
    }
  }

  return result.join('\n');
}

function getPriority(filename: string): number {
  return FILE_PRIORITY[getExt(filename)] ?? 50;
}

// ---- Main pipeline ----

export function runDiffPipeline(files: ChangedFile[], maxTokens: number = 64_000): FilteredDiff {
  const noiseFiles: string[] = [];
  const candidatePatches: { filename: string; patch: string; priority: number }[] = [];

  for (const file of files) {
    if (isNoiseFile(file.filename)) {
      noiseFiles.push(file.filename);
      file.isNoise = true;
      continue;
    }

    if (!file.patch) {
      noiseFiles.push(file.filename);
      file.isNoise = true;
      continue;
    }

    const patch = extractBusinessLines(file.patch);
    if (!patch.trim()) {
      noiseFiles.push(file.filename);
      file.isNoise = true;
      continue;
    }

    if (isFormatOnly(patch) || isImportOnly(patch)) {
      noiseFiles.push(file.filename);
      file.isNoise = true;
      continue;
    }

    file.isNoise = false;
    candidatePatches.push({
      filename: file.filename,
      patch,
      priority: getPriority(file.filename),
    });
  }

  // Sort by priority desc, then truncate
  candidatePatches.sort((a, b) => b.priority - a.priority);

  let tokenBudget = maxTokens;
  const businessPatches: FilePatch[] = [];

  for (const candidate of candidatePatches) {
    // Rough token estimate: 1 token ≈ 4 chars
    const estimatedTokens = Math.ceil(candidate.patch.length / 4);
    if (tokenBudget - estimatedTokens < 0 && businessPatches.length > 0) {
      continue;
    }
    businessPatches.push({
      filename: candidate.filename,
      patch: candidate.patch,
      lines: candidate.patch.split('\n').length,
    });
    tokenBudget -= estimatedTokens;
  }

  return {
    raw: files.map((f) => f.patch ?? '').join('\n'),
    businessPatches,
    noiseFiles,
  };
}
