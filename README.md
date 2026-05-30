# 🤖 X-Reviewer

AI-powered code review assistant for GitHub — built on Probot + DeepSeek for 七牛云 XEngineer 暑期实训营.

**Zero-config, zero-wait.** Push a PR, and X-Reviewer posts a structured review report directly in the PR thread — risk tables, fix suggestions, security scans, and quality scoring.

## Architecture

```
GitHub Webhook → Probot → Review Queue → AI Engine (DeepSeek v4-pro)
                              │                    │
                        Diff Pipeline      Security Scanner
                        Context Builder    FP Post-Processor
                              │                    │
                        Comment Manager ← Review Report ←──┘
```

### Module Map

| Module | Path | Purpose |
|--------|------|---------|
| Server | `src/server.ts` | HTTP server, env validation, health check, graceful shutdown |
| Probot App | `src/index.ts` | Webhook event routing (PR opened, comment created) |
| Types | `src/types/index.ts` | Core interfaces & enums (RiskLevel, ReviewReport, AIProvider, etc.) |
| Diff Pipeline | `src/services/diff-pipeline.ts` | Noise filtering, token budgeting, file prioritization |
| GitHub Client | `src/utils/github-client.ts` | Octokit wrapper — PR/files/comments, rate limits, issue linking |
| Context Builder | `src/services/context-builder.ts` | L0–L3 cascading: metadata → issues → file content → project detection |
| Prompt Builder | `src/services/prompt-builder.ts` | Mustache-style template engine with custom rules injection |
| AI Engine | `src/services/ai-engine.ts` | Primary/fallback provider orchestration, token logging |
| Output Parser | `src/services/output-parser.ts` | 3-tier: JSON → regex → empty fallback (never throws) |
| Review Queue | `src/queue/review-queue.ts` | In-memory queue with retry, exponential backoff, dedup, dead-letter |
| Comment Manager | `src/services/comment-manager.ts` | Placeholder → seamless replace, delay notices, Markdown rendering |
| Security Scanner | `src/security/rules-engine.ts` | 14 rules: XSS, injection, secrets, SSRF, path traversal, auth, crypto |
| Security Rules | `src/security/rules-registry.ts` | Rule definitions with CWE/OWASP references |
| FP Control | `src/services/review-post-processor.ts` | False positive detection, confidence adjustment, cross-validation |
| Slash Commands | `src/commands/slash-commands.ts` | `/review`, `/deep-review`, `/skip`, `/help` parser + authorization |
| Rate Limiter | `src/services/rate-limiter.ts` | Sliding-window limiter, cooldown, abuse detection |
| Logger | `src/utils/logger.ts` | Structured logger with level filtering & JSON mode |
| Error Handler | `src/utils/error-handler.ts` | Error classification, global handlers, GitHub comment formatting |
| DeepSeek Provider | `src/providers/deepseek.ts` | OpenAI-compatible API adapter with timeout |

## Quick Start

### Prerequisites

- Node.js ≥ 22
- A GitHub App (create at https://github.com/settings/apps)
- DeepSeek API key (https://platform.deepseek.com)

### 1. Clone & Install

```bash
git clone https://github.com/magicman1324/X-Reviewer.git
cd X-Reviewer
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in the required values:

| Variable | Description |
|----------|-------------|
| `APP_ID` | GitHub App ID |
| `PRIVATE_KEY` | GitHub App private key (PEM) |
| `WEBHOOK_SECRET` | GitHub App webhook secret |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | DeepSeek API base URL (default: `https://api.deepseek.com/v1`) |
| `PORT` | HTTP server port (default: `3000`) |
| `LOG_LEVEL` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `LOG_JSON` | Set `true` for structured JSON log output |

### 3. GitHub App Setup

1. Create a GitHub App with these permissions:
   - **Pull requests** — Read & Write
   - **Issues** — Read & Write (for linked issue injection)
   - **Metadata** — Read (mandatory)
2. Subscribe to events: **Pull request** (opened, synchronize) and **Issue comment** (created)
3. Generate and download the private key
4. Set the Webhook URL to your deployed server: `https://your-domain.com/api/github/webhooks`
5. Install the App on your target repository

### 4. Run

```bash
# Development (with auto-reload)
npm run dev

# Production
npm run build
npm start
```

### 5. Verify

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":12.3,"memory":{"heapUsedMB":45,"heapTotalMB":64,"rssMB":92}}
```

## Slash Commands

Comment on any PR to trigger actions:

| Command | Who Can Use | Description |
|---------|-------------|-------------|
| `/review` | Anyone | Trigger a full AI code review |
| `/deep-review` | PR author / Collaborators | Deep review with full file context + security scan |
| `/skip` | PR author / Collaborators | Skip review for this PR |
| `/help` | Anyone | Show command help |

## Review Report Format

Each review produces a structured GitHub comment:

- **📝 Summary** — One-sentence change overview
- **⚠️ Risk Table** — Critical (🔴) and Warning (🟡) items with file, line, and fix suggestions
- **💡 Fix Suggestions** — Executable code snippets with syntax highlighting (30+ languages)
- **📊 Quality Score** — 0–10 with emoji badge and label
- **🏷️ Suggested Labels** — Auto-suggested GitHub labels
- **🔗 CWE/OWASP References** — For security-rule matches

Long reports auto-fold with `<details>`/`<summary>` tags to keep the PR thread readable.

## Testing

```bash
# Run all test suites (~440 tests)
for f in scripts/test-*.ts; do npx tsx "$f"; done

# Run a specific suite
npx tsx scripts/test-security-rules.ts
npx tsx scripts/test-comment-manager.ts
```

## Project Structure

```
X-Reviewer/
├── src/
│   ├── index.ts              # Probot app entry
│   ├── server.ts             # HTTP server + graceful shutdown
│   ├── types/                # TypeScript interfaces & enums
│   ├── services/             # Business logic
│   │   ├── diff-pipeline.ts
│   │   ├── context-builder.ts
│   │   ├── prompt-builder.ts
│   │   ├── ai-engine.ts
│   │   ├── output-parser.ts
│   │   ├── comment-manager.ts
│   │   ├── review-post-processor.ts
│   │   └── rate-limiter.ts
│   ├── queue/                # Async job processing
│   │   └── review-queue.ts
│   ├── security/             # Security scanning
│   │   ├── rules-registry.ts
│   │   └── rules-engine.ts
│   ├── commands/             # Slash command parser
│   │   └── slash-commands.ts
│   ├── providers/            # AI model adapters
│   │   └── deepseek.ts
│   └── utils/                # Shared utilities
│       ├── github-client.ts
│       ├── logger.ts
│       └── error-handler.ts
├── scripts/                  # Test suites
│   ├── test-diff-pipeline.ts
│   ├── test-github-client.ts
│   ├── test-context-builder.ts
│   ├── test-prompt-builder.ts
│   ├── test-ai-engine.ts
│   ├── test-output-parser.ts
│   ├── test-review-queue.ts
│   ├── test-comment-manager.ts
│   ├── test-security-rules.ts
│   ├── test-review-post-processor.ts
│   ├── test-slash-commands.ts
│   ├── test-rate-limiter.ts
│   └── test-error-handler.ts
├── Dockerfile
├── tsconfig.json
├── eslint.config.mjs
├── .env.example
└── README.md
```

## Tech Stack

- **Runtime:** Node.js 22 + TypeScript (strict mode, ES2022)
- **Framework:** Probot 14 (GitHub App SDK)
- **AI Model:** DeepSeek v4-pro (OpenAI-compatible API)
- **Queue:** In-memory (BullMQ-compatible interface, Redis-ready)
- **Logging:** Structured (human-readable + JSON modes)
- **Testing:** Hand-rolled test runner (`npx tsx scripts/test-*.ts`)

## License

MIT
