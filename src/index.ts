import { Probot } from 'probot';

/**
 * X-Reviewer: AI-powered code review assistant for GitHub pull requests.
 */
export default (app: Probot) => {
  app.log.info('X-Reviewer GitHub App started');

  app.on('pull_request.opened', async (context) => {
    const pr = context.payload.pull_request;
    app.log.info(`PR #${pr.number} opened: ${pr.title}`);

    // Placeholder — AI review logic will be added in later PRs
    await context.octokit.rest.issues.createComment(
      context.issue({ body: '🤖 *X-Reviewer is analyzing your code... (powered by AI)*' }),
    );
  });

  app.on('pull_request.synchronize', async (context) => {
    const pr = context.payload.pull_request;
    app.log.info(`PR #${pr.number} updated with new commits`);
  });
};
