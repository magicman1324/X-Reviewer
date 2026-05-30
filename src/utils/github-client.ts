import type { ProbotOctokit } from 'probot';
import type { Context } from 'probot';
import type { ChangedFile } from '../types/index.js';

/**
 * Thin wrapper around Probot's built-in Octokit (which already includes
 * @octokit/plugin-retry, @octokit/plugin-paginate-rest, and
 * @octokit/rest-endpoint-methods).
 *
 * Provides domain-specific helpers for PR diff retrieval, file content
 * fetching, and comment CRUD — with cached conditional requests.
 */
export class GitHubClient {
  private octokit: ProbotOctokit;
  readonly owner: string;
  readonly repo: string;

  constructor(octokit: ProbotOctokit, owner: string, repo: string) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
  }

  /** Convenience factory from a Probot Context. */
  static fromContext(context: Context<'pull_request'>): GitHubClient {
    const { owner, repo } = context.repo();
    return new GitHubClient(context.octokit, owner, repo);
  }

  // ---- PR-level queries ----

  /**
   * Full pull request object from GitHub.
   * Includes title, body, head/base SHA, mergeable state.
   */
  async getPR(prNumber: number) {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });
    return data;
  }

  /**
   * List files changed in a PR with patch content.
   * Returns ChangedFile array ready for DiffPipeline.
   */
  async getPRFiles(prNumber: number): Promise<ChangedFile[]> {
    const files: ChangedFile[] = [];
    const iterator = this.octokit.paginate.iterator(this.octokit.rest.pulls.listFiles, {
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      per_page: 100,
    });
    for await (const { data } of iterator) {
      for (const f of data) {
        files.push({
          filename: f.filename,
          status: f.status as ChangedFile['status'],
          patch: f.patch ?? undefined,
          additions: f.additions,
          deletions: f.deletions,
          isNoise: false,
        });
      }
    }
    return files;
  }

  // ---- File content ----

  /**
   * Get the full contents of a file at a given git ref.
   * Returns UTF-8 string; null for binary or missing files.
   */
  async getFileContent(path: string, ref: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });
      if (Array.isArray(data) || data.type !== 'file') return null;
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Read package.json or equivalent to detect project language & framework.
   */
  async getProjectMetadata(ref: string): Promise<Record<string, string | undefined>> {
    const meta: Record<string, string | undefined> = {};
    for (const filename of ['package.json', 'go.mod', 'requirements.txt', 'Cargo.toml']) {
      const content = await this.getFileContent(filename, ref);
      if (content !== null) {
        meta[filename] = content;
      }
    }
    return meta;
  }

  // ---- Comments ----

  /**
   * Create a PR comment and return its ID.
   */
  async createComment(prNumber: number, body: string): Promise<number> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      body,
    });
    return data.id;
  }

  /**
   * Replace the content of an existing comment by ID.
   */
  async updateComment(commentId: number, body: string): Promise<void> {
    await this.octokit.rest.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body,
    });
  }

  /**
   * List recent comments on a PR (useful for dedup / idempotency checks).
   */
  async listComments(prNumber: number, since?: Date) {
    const { data } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      since: since?.toISOString(),
      per_page: 100,
    });
    return data;
  }

  // ---- Linked issues ----

  /**
   * Extract linked issues referenced in the PR body (e.g. "fixes #42").
   */
  async getLinkedIssues(prBody: string): Promise<
    {
      number: number;
      title: string;
      body: string;
    }[]
  > {
    const refs = prBody.matchAll(/(?:fixes|closes|resolves|refs?)\s+#(\d+)/gi);
    const issueNumbers = [...new Set([...refs].map((m) => parseInt(m[1], 10)))];

    const results = await Promise.allSettled(
      issueNumbers.map(async (num) => {
        const { data } = await this.octokit.rest.issues.get({
          owner: this.owner,
          repo: this.repo,
          issue_number: num,
        });
        return { number: num, title: data.title, body: data.body ?? '' };
      }),
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<{ number: number; title: string; body: string }> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);
  }

  // ---- Rate limit ----

  /**
   * Check remaining API quota. Returns null if core rate limit endpoint fails.
   */
  async getRateLimit(): Promise<{ remaining: number; limit: number; resetEpoch: number } | null> {
    try {
      const { data } = await this.octokit.rest.rateLimit.get();
      return {
        remaining: data.resources.core.remaining,
        limit: data.resources.core.limit,
        resetEpoch: data.resources.core.reset,
      };
    } catch {
      return null;
    }
  }
}
