/**
 * AI Code Reviewer GitHub Bot
 *
 * Main entry point — registers Probot event handlers for pull_request
 * events and orchestrates the AI-powered review pipeline.
 */

require("dotenv").config();
const { reviewPullRequest } = require("./src/reviewer");

/**
 * @param {import('probot').Probot} app
 */
module.exports = (app) => {
  app.log.info("🤖 AI Code Reviewer Bot loaded and ready");

  // ── Trigger review on PR opened or updated ──────────────────
  app.on(
    ["pull_request.opened", "pull_request.synchronize"],
    async (context) => {
      const pr = context.payload.pull_request;
      const repo = context.repo();

      app.log.info(
        `📝 Reviewing PR #${pr.number} "${pr.title}" in ${repo.owner}/${repo.repo}`
      );

      try {
        // Post a pending status check
        await context.octokit.repos.createCommitStatus({
          ...repo,
          sha: pr.head.sha,
          state: "pending",
          description: "AI code review in progress…",
          context: "AI Code Reviewer",
        });

        // Run the review pipeline
        const reviewResult = await reviewPullRequest(context, pr);

        // Post results
        if (reviewResult.comments.length > 0) {
          // Submit inline review comments
          await context.octokit.pulls.createReview({
            ...repo,
            pull_number: pr.number,
            commit_id: pr.head.sha,
            body: buildReviewSummary(reviewResult),
            event: "COMMENT",
            comments: reviewResult.comments,
          });

          app.log.info(
            `✅ Posted ${reviewResult.comments.length} review comment(s) on PR #${pr.number}`
          );
        } else {
          // No issues found — post a clean summary comment
          await context.octokit.issues.createComment({
            ...repo,
            issue_number: pr.number,
            body: "## 🤖 AI Code Review\n\n✅ **No issues found.** The changes in this PR look good.\n\n---\n*Reviewed by AI Code Reviewer Bot*",
          });

          app.log.info(`✅ PR #${pr.number} — no issues found`);
        }

        // Update commit status
        await context.octokit.repos.createCommitStatus({
          ...repo,
          sha: pr.head.sha,
          state: reviewResult.hasCritical ? "failure" : "success",
          description: reviewResult.hasCritical
            ? `Found ${reviewResult.comments.length} issue(s) — ${reviewResult.criticalCount} critical`
            : reviewResult.comments.length > 0
            ? `Found ${reviewResult.comments.length} issue(s) — no critical`
            : "No issues found",
          context: "AI Code Reviewer",
        });
      } catch (error) {
        app.log.error(`❌ Error reviewing PR #${pr.number}:`, error);

        // Set error status
        await context.octokit.repos
          .createCommitStatus({
            ...repo,
            sha: pr.head.sha,
            state: "error",
            description: "AI review failed — see logs",
            context: "AI Code Reviewer",
          })
          .catch(() => {}); // Don't throw on status update failure

        // Post error comment
        await context.octokit.issues
          .createComment({
            ...repo,
            issue_number: pr.number,
            body: `## 🤖 AI Code Review\n\n⚠️ **Review failed.** An error occurred during the automated review.\n\n<details>\n<summary>Error details</summary>\n\n\`\`\`\n${error.message}\n\`\`\`\n</details>\n\n---\n*Reviewed by AI Code Reviewer Bot*`,
          })
          .catch(() => {});
      }
    }
  );

  // ── Handle re-review request via comment command ────────────
  app.on("issue_comment.created", async (context) => {
    const comment = context.payload.comment;
    const issue = context.payload.issue;

    // Only respond to "/review" commands on PRs
    if (!issue.pull_request || !comment.body.trim().startsWith("/review")) {
      return;
    }

    const repo = context.repo();

    app.log.info(
      `🔄 Re-review requested for PR #${issue.number} by @${comment.user.login}`
    );

    try {
      // Fetch full PR data
      const { data: pr } = await context.octokit.pulls.get({
        ...repo,
        pull_number: issue.number,
      });

      // Acknowledge the command
      await context.octokit.reactions.createForIssueComment({
        ...repo,
        comment_id: comment.id,
        content: "eyes",
      });

      // Run review
      const reviewResult = await reviewPullRequest(context, pr);

      if (reviewResult.comments.length > 0) {
        await context.octokit.pulls.createReview({
          ...repo,
          pull_number: pr.number,
          commit_id: pr.head.sha,
          body: buildReviewSummary(reviewResult),
          event: "COMMENT",
          comments: reviewResult.comments,
        });
      } else {
        await context.octokit.issues.createComment({
          ...repo,
          issue_number: pr.number,
          body: "## 🤖 AI Code Review (Re-review)\n\n✅ **No issues found.** The changes look good.\n\n---\n*Reviewed by AI Code Reviewer Bot*",
        });
      }

      // React with check mark
      await context.octokit.reactions.createForIssueComment({
        ...repo,
        comment_id: comment.id,
        content: "rocket",
      });
    } catch (error) {
      app.log.error(`❌ Re-review failed for PR #${issue.number}:`, error);

      await context.octokit.reactions
        .createForIssueComment({
          ...repo,
          comment_id: comment.id,
          content: "confused",
        })
        .catch(() => {});
    }
  });
};

/**
 * Builds a markdown summary for the review.
 */
function buildReviewSummary(reviewResult) {
  const { criticalCount, warningCount, suggestionCount, filesReviewed } =
    reviewResult;

  const lines = [
    "## 🤖 AI Code Review Summary",
    "",
    `| Severity | Count |`,
    `|----------|-------|`,
    `| 🔴 Critical | ${criticalCount} |`,
    `| 🟡 Warning | ${warningCount} |`,
    `| 🔵 Suggestion | ${suggestionCount} |`,
    "",
    `**Files reviewed:** ${filesReviewed}`,
    "",
    "---",
    "*Reviewed by AI Code Reviewer Bot — powered by Google Gemini*",
  ];

  return lines.join("\n");
}
