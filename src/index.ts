import { Probot } from 'probot';

/**
 * X-Reviewer: AI-powered code review assistant for GitHub pull requests.
 *
 * This module exports the Probot application function — the only required
 * entry point for Probot. Webhook signature verification is handled
 * automatically by Probot's built-in createNodeMiddleware.
 */
export default (app: Probot) => {
  app.log.info('X-Reviewer GitHub App loaded');

  app.on('pull_request.opened', async (context) => {
    const pr = context.payload.pull_request;
    app.log.info(`PR #${pr.number} opened: ${pr.title}`);

    await context.octokit.rest.issues.createComment(
      context.issue({ body: '🤖 *X-Reviewer is analyzing your code... (powered by AI)*' }),
    );
  });

  app.on('pull_request.synchronize', async (context) => {
    const pr = context.payload.pull_request;
    app.log.info(`PR #${pr.number} updated with new commits`);
  });

  app.on('installation.created', async (context) => {
    const account = context.payload.installation.account;
    if (account && 'login' in account) {
      app.log.info(`App installed on ${account.login}`);
    }
  });
};
