import { Probot } from 'probot';
import { GitHubClient } from './utils/github-client.js';
import { buildContext } from './services/context-builder.js';
import { AIEngine } from './services/ai-engine.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { CommentManager } from './services/comment-manager.js';
import { ReviewQueue } from './queue/review-queue.js';
import { SecurityScanner } from './security/rules-engine.js';
import { ReviewPostProcessor } from './services/review-post-processor.js';
import { SignalBooster } from './services/signal-booster.js';
import { TriggerSource } from './types/index.js';
import { getLogger } from './utils/logger.js';
import { handleError } from './utils/error-handler.js';

/**
 * X-Reviewer: AI-powered code review assistant.
 *
 * Pipeline: Webhook → Diff → Context → Prompt → DeepSeek → Parse → PostProcess → SignalBoost → Comment
 */
export default (app: Probot) => {
  const log = getLogger();
  log.info('X-Reviewer GitHub App loaded');

  const deepseek = new DeepSeekProvider({
    apiKey: process.env.DEEPSEEK_API_KEY!,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    timeoutMs: 120_000,
  });

  const aiEngine = new AIEngine({ primary: deepseek });
  const commentManager = new CommentManager();
  const reviewQueue = new ReviewQueue(2, { maxAttempts: 2, backoffBaseMs: 3000 });
  const securityScanner = new SecurityScanner();
  const postProcessor = new ReviewPostProcessor();
  const signalBooster = new SignalBooster(25);

  reviewQueue.process(async (job) => {
    const { request, commentId } = job;
    const instId = request.installationId;
    if (!instId) {
      log.error('Missing installationId on review request');
      return;
    }

    const octokit = await app.auth(instId);
    const client = new GitHubClient(octokit, request.owner, request.repo);

    const report = await aiEngine.analyze(request, [], log);
    const securityResult = securityScanner.scanDiff(request.diff);
    const merged = securityScanner.mergeWithAIReport(report.risks, securityResult.risks);
    const processed = postProcessor.process({
      ...report,
      risks: postProcessor.crossValidate(merged, securityResult.risks),
    });

    const boosted = signalBooster.boost(processed);

    await commentManager.publishReport(client, commentId, boosted);
    const sq = boosted.signalQuality;
    log.info(
      `Review done PR #${request.prNumber}: score=${boosted.overallScore.toFixed(1)} risks=${boosted.risks.filter((r) => !r.isNoise).length}/${boosted.risks.length} SNR=${(sq.signalToNoiseRatio * 100).toFixed(0)}% trust=${(sq.overallTrust * 100).toFixed(0)}% dedup=${sq.duplicateCount} noise=${sq.suppressedCount}`,
    );
  });

  app.on('pull_request.opened', async (context) => {
    const pr = context.payload.pull_request;
    const { owner, repo } = context.repo();

    app.log.info(`PR #${pr.number} opened: ${pr.title}`);

    try {
      const client = GitHubClient.fromContext(context);
      const reviewRequest = await buildContext({
        client,
        prNumber: pr.number,
        trigger: TriggerSource.PR_Opened,
      });
      const instId = context.payload.installation?.id;
      if (!instId) {
        app.log.warn('No installation ID in payload, skipping review');
        return;
      }
      reviewRequest.installationId = instId;

      const commentId = await commentManager.postPlaceholder(client, pr.number);
      commentManager.startDelayNotice(client, commentId);
      await reviewQueue.add(reviewRequest, commentId);

      app.log.info(`Review enqueued for PR #${pr.number}`);
    } catch (err) {
      handleError(err as Error, { prNumber: pr.number, owner, repo, phase: 'pr_opened' });
    }
  });

  app.on('installation.created', async (context) => {
    const account = context.payload.installation.account;
    if (account && 'login' in account) {
      app.log.info(`App installed on ${account.login}`);
    }
  });
};
