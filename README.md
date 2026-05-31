# X-Reviewer

AI-powered code review assistant for GitHub — built on Probot + DeepSeek for the XEngineer Summer Camp.

**Pre-configured, zero-setup.** All API keys and credentials are baked in. Clone, install, run — the app posts structured review reports directly in PR threads with risk tables, fix suggestions, security scans, and quality scoring.

## Quick Start

 **演示视频下载**：[百度网盘](https://pan.baidu.com/s/1u2rNHbjt7ffKugXER44JvQ?pwd=4p4u) 提取码：`4p4u`

```bash
# One-command start
./start.sh        # Linux / macOS
start.bat         # Windows

# Or manually:
npm install
npm run dev
```

The server starts on port 3000. All credentials (DeepSeek API, GitHub App) are pre-configured in `.env` — no setup required.

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":12.3,"memory":{"heapUsedMB":45,"heapTotalMB":64,"rssMB":92}}
```

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
| Probot App | `src/index.ts` | Webhook event routing, full pipeline orchestration |
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

## Configuration

The `.env` file is pre-configured for evaluation. To use your own credentials, edit these values:

| Variable | Description |
|----------|-------------|
| `APP_ID` | GitHub App ID |
| `PRIVATE_KEY` | GitHub App private key (PEM, quoted with `\n` newlines) |
| `WEBHOOK_SECRET` | GitHub App webhook secret |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | DeepSeek API base URL (default: `https://api.deepseek.com/v1`) |
| `PORT` | HTTP server port (default: `3000`) |
| `LOG_LEVEL` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `LOG_JSON` | Set `true` for structured JSON log output |

## GitHub App Setup (for custom deployment)

1. Create a GitHub App at https://github.com/settings/apps with these permissions:
   - **Pull requests** — Read & Write
   - **Issues** — Read & Write
   - **Metadata** — Read (mandatory)
2. Subscribe to events: **Pull request** (opened, synchronize) and **Issue comment** (created)
3. Download the private key and configure the `.env` variables above
4. Set the Webhook URL to `https://your-domain.com/api/github/webhooks` (use ngrok for local testing)
5. Install the App on your target repository

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

- **Summary** — One-sentence change overview
- **Risk Table** — Critical and Warning items with file, line, and fix suggestions
- **Fix Suggestions** — Executable code snippets with syntax highlighting
- **Quality Score** — 0–10 with label
- **Suggested Labels** — Auto-suggested GitHub labels
- **CWE/OWASP References** — For security-rule matches

Long reports auto-fold with `<details>`/`<summary>` tags to keep the PR thread readable.

## Testing

```bash
# Run the test suite
npm test

# Run all test files
for f in scripts/test-*.ts; do npx tsx --env-file=.env "$f"; done

# Run a specific suite
npx tsx --env-file=.env scripts/test-security-rules.ts
npx tsx --env-file=.env scripts/test-user-handler.ts
```

## Project Structure

```
X-Reviewer/
├── src/
│   ├── index.ts                  # Probot app entry (pipeline orchestration)
│   ├── server.ts                 # HTTP server + graceful shutdown
│   ├── types/index.ts            # TypeScript interfaces & enums
│   ├── services/
│   │   ├── diff-pipeline.ts
│   │   ├── context-builder.ts
│   │   ├── prompt-builder.ts
│   │   ├── ai-engine.ts
│   │   ├── output-parser.ts
│   │   ├── comment-manager.ts
│   │   ├── review-post-processor.ts
│   │   ├── rate-limiter.ts
│   │   └── user-handler.ts       # Demo module (intentionally vulnerable, for AI review testing)
│   ├── queue/
│   │   └── review-queue.ts
│   ├── security/
│   │   ├── rules-registry.ts
│   │   └── rules-engine.ts
│   ├── commands/
│   │   └── slash-commands.ts
│   ├── providers/
│   │   └── deepseek.ts
│   └── utils/
│       ├── github-client.ts
│       ├── logger.ts
│       └── error-handler.ts
├── scripts/                      # Test suites (14 files)
│   └── test-*.ts
├── .env                          # Pre-configured credentials
├── .env.example                  # Template for custom deployments
├── start.sh / start.bat          # One-click startup scripts
├── Dockerfile
├── tsconfig.json
├── eslint.config.mjs
└── package.json
```

## Tech Stack

- **Runtime:** Node.js 22 + TypeScript (strict mode, ES2022)
- **Framework:** Probot 14 (GitHub App SDK)
- **AI Model:** DeepSeek v4-pro (OpenAI-compatible API)
- **Queue:** In-memory with BullMQ-compatible interface
- **Logging:** Structured (human-readable + JSON modes)

## License

MIT
