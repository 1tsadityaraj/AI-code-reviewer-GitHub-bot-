/**
 * AI Code Reviewer GitHub Bot
 *
 * Entry point — registers Probot event handlers for pull_request
 * events and orchestrates the AI-powered review pipeline.
 */

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { reviewPR, postReview } from "./src/reviewer.js";

/**
 * @param {import('probot').Probot} app
 */
export default (app) => {
  app.log.info("🤖 AI Code Reviewer Bot loaded");

  // Initialize the Gemini client once
  const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

        // Review PR using the new pipeline
        const result = await reviewPR(context, geminiClient);
        
        // Post the final summary and inline comments
        await postReview(context, result);

        // Update the commit status based on the verdict
        await context.octokit.repos.createCommitStatus({
          ...repo,
          sha: pr.head.sha,
          state: result.verdict === "needs_work" ? "failure" : "success",
          description: result.verdict === "needs_work"
            ? `Needs work — ${result.issues.length} issue(s) found`
            : "Approved — Code looks good",
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

      // Re-review PR using the new pipeline
      const result = await reviewPR(context, geminiClient);
      
      // Post the final summary and inline comments
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
