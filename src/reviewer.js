import { parseDiff } from "./parser.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

/**
 * Reviews a pull request by analyzing each file's diff using Gemini.
 *
 * @param {import('probot').Context} context
 * @param {object} geminiClient - GoogleGenerativeAI instance
 * @returns {Promise<{ verdict: string, summary: string, issues: Array }>}
 */
export async function reviewPR(context, geminiClient) {
  const repo = context.repo();
  const pr = context.payload.pull_request;
  const repoName = `${repo.owner}/${repo.repo}`;
  const author = pr.user.login;

  // Fetch the full PR diff
  const { data: rawDiff } = await context.octokit.pulls.get({
    ...repo,
    pull_number: pr.number,
    mediaType: { format: "diff" },
  });

  // Parse diff and limit to max 10 files
  const parsedFiles = parseDiff(rawDiff);
  const filesToReview = parsedFiles.slice(0, 10);

  // The passed `geminiClient` is already initialized with model and generationConfig
  const model = geminiClient;

  let finalVerdict = "approved";
  const summaries = [];
  const allIssues = [];

  for (const file of filesToReview) {
    if (!file.patch) continue;

    // Truncate to max 300 lines of diff per file
    const diffLines = file.patch.split("\n");
    const truncatedDiff = diffLines.slice(0, 300).join("\n");

    const fileDiffStr = `### File: ${file.filename}\n\`\`\`diff\n${truncatedDiff}\n\`\`\``;
    const userMessage = buildUserMessage(pr.title, repoName, author, fileDiffStr);

    try {
      const result = await model.generateContent([
        { text: SYSTEM_PROMPT },
        { text: userMessage },
      ]);
      
      const rawJson = result.response.text();
      const parsed = JSON.parse(rawJson);

      if (parsed.verdict === "needs_work") {
        finalVerdict = "needs_work";
      }

      if (parsed.summary) {
        summaries.push(`- **${file.filename}**: ${parsed.summary}`);
      }

      if (Array.isArray(parsed.issues)) {
        allIssues.push(...parsed.issues);
      }
    } catch (err) {
      context.log.error(`Skipping file ${file.filename} due to error: ${err.message}`);
    }
  }

  return {
    verdict: finalVerdict,
    summary: summaries.length > 0 ? summaries.join("\n") : "No specific issues found.",
    issues: allIssues,
  };
}

/**
 * Creates a GitHub pull request review from the collected issues.
 *
 * @param {import('probot').Context} context
 * @param {object} reviewResult
 */
export async function postReview(context, reviewResult) {
  const repo = context.repo();
  const pr = context.payload.pull_request;
  const { verdict, summary, issues } = reviewResult;

  // Map each issue to an inline comment
  const comments = issues.map((issue) => {
    let icon = "🔵";
    if (issue.severity === "critical") icon = "🔴";
    if (issue.severity === "warning") icon = "🟡";

    return {
      path: issue.file,
      line: issue.line,
      side: "RIGHT",
      body: `${icon} **[${issue.category}]** ${issue.comment}`,
    };
  });

  const statusIcon = verdict === "approved" ? "✅" : "⚠️";
  const mainBody = `## 🤖 AI Code Review\n\n**Verdict:** ${statusIcon} ${
    verdict === "approved" ? "Approved" : "Needs Work"
  }\n\n### Summary\n${summary}`;

  try {
    // Post the overall summary as the review body
    await context.octokit.pulls.createReview({
      ...repo,
      pull_number: pr.number,
      commit_id: pr.head.sha,
      body: mainBody,
      event: "COMMENT", // Do not use APPROVE or REQUEST_CHANGES automatically
      comments: comments,
    });
    context.log.info(`Successfully posted review for PR #${pr.number}`);
  } catch (err) {
    context.log.error(`Failed to post review: ${err.message}`);
  }
}
