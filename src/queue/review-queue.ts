import { EventEmitter } from 'node:events';
import { QueueJobStatus } from '../types/index.js';
import type { ReviewRequest, QueueJob } from '../types/index.js';

export interface QueueOptions {
  /** Max retry attempts before moving to dead letter. Default 3. */
  maxAttempts?: number;
  /** Base backoff delay in ms. Default 2000. */
  backoffBaseMs?: number;
  /** Max backoff cap in ms. Default 60_000. */
  backoffMaxMs?: number;
  /** Remove completed jobs from memory. Default true. */
  removeOnComplete?: boolean;
}

const DEFAULT_OPTIONS: Required<QueueOptions> = {
  maxAttempts: 3,
  backoffBaseMs: 2000,
  backoffMaxMs: 60_000,
  removeOnComplete: true,
};

// eslint-disable-next-line no-unused-vars
export type JobHandler = (job: QueueJob) => Promise<void>;

/**
 * In-memory async review queue supporting retry, exponential backoff,
 * deduplication, and dead-letter storage.
 *
 * Interface mirrors BullMQ for easy migration when Redis is available.
 */
export class ReviewQueue extends EventEmitter {
  private options: Required<QueueOptions>;
  private pending: Map<string, QueueJob> = new Map();
  private dead: Map<string, QueueJob> = new Map();
  private activeCount = 0;
  private concurrency: number;
  private handler: JobHandler | null = null;

  constructor(concurrency = 1, options: QueueOptions = {}) {
    super();
    this.concurrency = concurrency;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Register the job processor.
   */
  process(handler: JobHandler): void {
    this.handler = handler;
  }

  /**
   * Enqueue a review job. Returns the job ID immediately.
   * If a job with the same key already exists, it is skipped.
   */
  async add(request: ReviewRequest, commentId: number): Promise<string> {
    const dedupeKey = buildDedupeKey(request);
    if (this.pending.has(dedupeKey)) {
      return dedupeKey;
    }

    const job: QueueJob = {
      id: dedupeKey,
      request,
      status: QueueJobStatus.Pending,
      commentId,
      createdAt: new Date(),
      attempts: 0,
    };

    this.pending.set(job.id, job);
    this.emit('waiting', job);

    setImmediate(() => this.drain());

    return job.id;
  }

  /**
   * Returns the job state for health checks.
   */
  getStats(): { pending: number; active: number; dead: number } {
    let pendingCount = 0;
    for (const j of this.pending.values()) {
      if (j.status === QueueJobStatus.Pending) pendingCount++;
    }
    return {
      pending: pendingCount,
      active: this.activeCount,
      dead: this.dead.size,
    };
  }

  /**
   * Look up a job by its dedupe key.
   */
  getJob(id: string): QueueJob | undefined {
    return this.pending.get(id) ?? this.dead.get(id);
  }

  // ---- Internal ----

  private drain(): void {
    while (this.activeCount < this.concurrency) {
      const job = this.nextPending();
      if (!job) break;
      this.activeCount++;
      this.run(job);
    }
  }

  private nextPending(): QueueJob | undefined {
    for (const [, job] of this.pending) {
      if (job.status === QueueJobStatus.Pending) {
        job.status = QueueJobStatus.Running;
        return job;
      }
    }
    return undefined;
  }

  private async run(job: QueueJob): Promise<void> {
    if (!this.handler) {
      this.fail(job, new Error('No handler registered'));
      return;
    }

    job.status = QueueJobStatus.Running;
    this.emit('active', job);

    try {
      await this.handler(job);
      job.status = QueueJobStatus.Completed;
      this.emit('completed', job);
      if (this.options.removeOnComplete) {
        this.pending.delete(job.id);
      }
    } catch (err) {
      job.attempts++;
      job.lastError = (err as Error).message;

      if (job.attempts < this.options.maxAttempts) {
        const baseDelay = this.options.backoffBaseMs * Math.pow(2, job.attempts - 1);
        const jitter = baseDelay * (Math.random() * 0.3);
        const delay = Math.min(baseDelay + jitter, this.options.backoffMaxMs);
        job.status = QueueJobStatus.Pending;
        this.emit('retrying', job, delay);
        setTimeout(() => this.drain(), delay);
      } else {
        this.fail(job, err as Error);
      }
    } finally {
      this.activeCount--;
      setImmediate(() => this.drain());
    }
  }

  private fail(job: QueueJob, err: Error): void {
    job.status = QueueJobStatus.Failed;
    job.lastError = err.message;
    this.dead.set(job.id, job);
    this.pending.delete(job.id);
    this.emit('failed', job, err);
  }
}

/**
 * Build a deduplication key from commit SHA and changed file paths.
 * Prevents re-reviewing the same code from the same commit.
 */
export function buildDedupeKey(request: ReviewRequest): string {
  const fileKey = request.files
    .filter((f) => !f.isNoise)
    .map((f) => f.filename)
    .sort()
    .join('|');
  return `${request.owner}/${request.repo}:${request.headSha}:${simpleHash(fileKey)}`;
}

/**
 * Fast non-crypto hash (Fnv1a-like) for dedup keys.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = (hash * 31 + ch) & 0x7fffffff;
  }
  return hash.toString(36);
}
