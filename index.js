/**
 * AI Code Reviewer GitHub Bot
 * Main Probot application entry point.
 */

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { reviewPR, postReview } from "./src/reviewer.js";

// Initialize the Gemini client once at the top
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiClient = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
  generationConfig: {
    temperature: 0,
    responseMimeType: "application/json",
  },
});

/**
 * @param {import('probot').Probot} app
 */
export default (app) => {
  app.log.info("🤖 AI Code Reviewer Bot loaded");

  // ── 1. Pull Request Events ──────────────────────────────────────────
  app.on(
    ["pull_request.opened", "pull_request.synchronize"],
    async (context) => {
      const pr = context.payload.pull_request;
      const repo = context.repo();

      // Guard: Skip massive PRs
      if (pr.changed_files > 50) {
        await context.octokit.issues.createComment({
          ...repo,
          issue_number: pr.number,
          body: "⚠️ **AI Code Review Skipped:** This PR modifies more than 50 files. The diff is too large for an automated review.",
        });
        return;
      }

      app.log.info(`📝 Reviewing PR #${pr.number} in ${repo.owner}/${repo.repo}`);

      try {
        await context.octokit.repos.createCommitStatus({
          ...repo,
          sha: pr.head.sha,
          state: "pending",
          description: "AI code review in progress…",
          context: "AI Code Reviewer",
        });

        // Delegate review logic to reviewer.js
        const result = await reviewPR(context, geminiClient);
        await postReview(context, result);

        // Calculate commit status
        const hasCritical = result.issues.some((i) => i.severity === "critical");

        await context.octokit.repos.createCommitStatus({
          ...repo,
          sha: pr.head.sha,
          state: hasCritical ? "failure" : "success",
          description: hasCritical
            ? "Critical issues found"
            : "Review complete — no critical issues",
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

  // ── 2. Issue Comment Event (/review) ────────────────────────────────
  app.on("issue_comment.created", async (context) => {
    const { comment, issue } = context.payload;
    const repo = context.repo();

    // Guard: Only respond to exactly "/review" on a Pull Request
    if (!issue.pull_request || comment.body.trim() !== "/review") {
      return;
    }

    try {
      // Fetch the full PR object to get the changed_files count
      const { data: pr } = await context.octokit.pulls.get({
        ...repo,
        pull_number: issue.number,
      });

      // Guard: Skip massive PRs
      if (pr.changed_files > 50) {
        await context.octokit.issues.createComment({
          ...repo,
          issue_number: pr.number,
          body: "⚠️ **AI Code Review Skipped:** This PR modifies more than 50 files. The diff is too large for an automated review.",
        });
        return;
      }

      await context.octokit.reactions.createForIssueComment({
        ...repo,
        comment_id: comment.id,
        content: "eyes",
      });

      // Delegate review logic to reviewer.js
      const result = await reviewPR(context, geminiClient);
      await postReview(context, result);

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
