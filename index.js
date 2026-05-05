/**
 * AI Code Reviewer GitHub Bot
 *
 * Entry point — registers Probot event handlers for pull_request
 * events and orchestrates the AI-powered review pipeline.
 */

import "dotenv/config";
import { reviewPullRequest } from "./src/reviewer.js";

/**
 * @param {import('probot').Probot} app
 */
export default (app) => {
  app.log.info("🤖 AI Code Reviewer Bot loaded");

  // ── Review on PR opened or updated ──────────────────────────
  app.on(
    ["pull_request.opened", "pull_request.synchronize"],
    async (context) => {
      const pr = context.payload.pull_request;
      const repo = context.repo();

      app.log.info(
        `📝 Reviewing PR #${pr.number} "${pr.title}" in ${repo.owner}/${repo.repo}`
      );

      try {
        await context.octokit.repos.createCommitStatus({
          ...repo,
          sha: pr.head.sha,
          state: "pending",
          description: "AI code review in progress…",
          context: "AI Code Reviewer",
        });

        const result = await reviewPullRequest(context, pr);

        if (result.comments.length > 0) {
          await context.octokit.pulls.createReview({
            ...repo,
            pull_number: pr.number,
            commit_id: pr.head.sha,
            body: buildSummary(result),
            event: "COMMENT",
            comments: result.comments,
          });
        } else {
          await context.octokit.issues.createComment({
            ...repo,
            issue_number: pr.number,
            body: "## 🤖 AI Code Review\n\n✅ **No issues found.** The changes look good.\n\n---\n*Reviewed by AI Code Reviewer Bot*",
          });
        }

        await context.octokit.repos.createCommitStatus({
          ...repo,
          sha: pr.head.sha,
          state: result.hasCritical ? "failure" : "success",
          description: result.hasCritical
            ? `${result.comments.length} issue(s) — ${result.criticalCount} critical`
            : result.comments.length > 0
              ? `${result.comments.length} issue(s) — no critical`
              : "No issues found",
          context: "AI Code Reviewer",
        });
      } catch (error) {
        app.log.error(`❌ Review failed for PR #${pr.number}:`, error);

        await context.octokit.repos
          .createCommitStatus({
            ...repo,
            sha: pr.head.sha,
            state: "error",
            description: "AI review failed — see logs",
            context: "AI Code Reviewer",
          })
          .catch(() => {});
      }
    }
  );

  // ── Re-review via "/review" comment command ─────────────────
  app.on("issue_comment.created", async (context) => {
    const { comment, issue } = context.payload;

    if (!issue.pull_request || !comment.body.trim().startsWith("/review")) {
      return;
    }

    const repo = context.repo();

    try {
      const { data: pr } = await context.octokit.pulls.get({
        ...repo,
        pull_number: issue.number,
      });

      await context.octokit.reactions.createForIssueComment({
        ...repo,
        comment_id: comment.id,
        content: "eyes",
      });

      const result = await reviewPullRequest(context, pr);

      if (result.comments.length > 0) {
        await context.octokit.pulls.createReview({
          ...repo,
          pull_number: pr.number,
          commit_id: pr.head.sha,
          body: buildSummary(result),
          event: "COMMENT",
          comments: result.comments,
        });
      } else {
        await context.octokit.issues.createComment({
          ...repo,
          issue_number: pr.number,
          body: "## 🤖 AI Code Review (Re-review)\n\n✅ **No issues found.**\n\n---\n*Reviewed by AI Code Reviewer Bot*",
        });
      }

      await context.octokit.reactions.createForIssueComment({
        ...repo,
        comment_id: comment.id,
        content: "rocket",
      });
    } catch (error) {
      app.log.error(`❌ Re-review failed for PR #${issue.number}:`, error);
    }
  });
};

/**
 * Builds a markdown summary table for the review.
 */
function buildSummary({ verdict, summary, criticalCount, warningCount, suggestionCount, filesReviewed }) {
  const statusIcon = verdict === "approved" ? "✅" : "⚠️";
  
  return [
    `## 🤖 AI Code Review Summary`,
    "",
    `**Verdict:** ${statusIcon} ${verdict === "approved" ? "Approved" : "Needs Work"}`,
    `**Summary:** ${summary}`,
    "",
    "| Severity | Count |",
    "|----------|-------|",
    `| 🔴 Critical | ${criticalCount} |`,
    `| 🟡 Warning | ${warningCount} |`,
    `| 🔵 Suggestion | ${suggestionCount} |`,
    "",
    `**Files reviewed:** ${filesReviewed}`,
    "",
    "---",
    "*Reviewed by AI Code Reviewer Bot — powered by Google Gemini*",
  ].join("\n");
}
