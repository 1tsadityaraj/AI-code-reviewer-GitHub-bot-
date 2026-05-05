/**
 * AI Review Engine
 *
 * Orchestrates the review pipeline: fetches diff → parses files →
 * sends to Gemini for analysis → maps feedback to inline comments.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { parseDiff } = require("./parser");
const { REVIEW_PROMPT } = require("./prompt");

// ── Configuration ─────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_REVIEW || "15", 10);
const MAX_DIFF_SIZE = parseInt(process.env.MAX_DIFF_SIZE || "12000", 10);

// File patterns to skip during review
const SKIP_PATTERNS = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/,
  /^\.env/,
  /^dist\//,
  /^build\//,
  /^coverage\//,
  /^node_modules\//,
  /\.map$/,
];

/**
 * Reviews a pull request end-to-end.
 *
 * @param {import('probot').Context} context  Probot context
 * @param {object}                   pr       Pull request payload
 * @returns {Promise<ReviewResult>}
 */
async function reviewPullRequest(context, pr) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Set it in your environment."
    );
  }

  const repo = context.repo();

  // 1. Fetch the raw diff
  const { data: diff } = await context.octokit.pulls.get({
    ...repo,
    pull_number: pr.number,
    mediaType: { format: "diff" },
  });

  // 2. Parse into per-file hunks
  const files = parseDiff(diff);

  // 3. Filter out irrelevant files
  const reviewableFiles = files
    .filter((f) => !SKIP_PATTERNS.some((pattern) => pattern.test(f.filename)))
    .filter((f) => f.additions > 0) // Only review files with additions
    .slice(0, MAX_FILES);

  if (reviewableFiles.length === 0) {
    return {
      comments: [],
      hasCritical: false,
      criticalCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      filesReviewed: 0,
    };
  }

  // 4. Build per-file diffs for the AI
  const fileDiffs = reviewableFiles.map((file) => {
    let diffContent = file.patch || "";

    // Truncate oversized diffs
    if (diffContent.length > MAX_DIFF_SIZE) {
      diffContent =
        diffContent.substring(0, MAX_DIFF_SIZE) +
        "\n... [diff truncated for size]";
    }

    return {
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      diff: diffContent,
    };
  });

  // 5. Call Gemini for review
  const aiResponse = await callGemini(fileDiffs, pr);

  // 6. Map AI output to GitHub review comments
  const comments = mapToGitHubComments(aiResponse, reviewableFiles);

  // 7. Compute severity counts
  let criticalCount = 0;
  let warningCount = 0;
  let suggestionCount = 0;

  for (const issue of aiResponse) {
    switch (issue.severity) {
      case "critical":
        criticalCount++;
        break;
      case "warning":
        warningCount++;
        break;
      case "suggestion":
        suggestionCount++;
        break;
    }
  }

  return {
    comments,
    hasCritical: criticalCount > 0,
    criticalCount,
    warningCount,
    suggestionCount,
    filesReviewed: reviewableFiles.length,
  };
}

/**
 * Sends file diffs to Google Gemini and parses the structured response.
 *
 * @param {Array}  fileDiffs  Array of { filename, status, diff }
 * @param {object} pr         Pull request metadata
 * @returns {Promise<Array>}  Array of issue objects
 */
async function callGemini(fileDiffs, pr) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.3, // Low creativity for precise reviews
      topP: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  // Build the user prompt with PR context + file diffs
  const userPrompt = buildUserPrompt(fileDiffs, pr);

  const result = await model.generateContent([
    { text: REVIEW_PROMPT },
    { text: userPrompt },
  ]);

  const responseText = result.response.text();

  try {
    const parsed = JSON.parse(responseText);

    // Handle both { issues: [...] } and direct array
    const issues = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.issues)
      ? parsed.issues
      : [];

    // Validate and sanitize each issue
    return issues
      .filter(
        (issue) =>
          issue &&
          typeof issue.file === "string" &&
          typeof issue.line === "number" &&
          typeof issue.comment === "string" &&
          typeof issue.severity === "string"
      )
      .map((issue) => ({
        file: issue.file,
        line: Math.max(1, Math.floor(issue.line)),
        comment: issue.comment.substring(0, 500), // Cap comment length
        severity: ["critical", "warning", "suggestion"].includes(issue.severity)
          ? issue.severity
          : "suggestion",
        category: issue.category || "general",
      }));
  } catch (parseError) {
    console.error("Failed to parse Gemini response:", parseError.message);
    console.error("Raw response:", responseText.substring(0, 500));
    return [];
  }
}

/**
 * Builds the user-facing prompt with PR context and diffs.
 */
function buildUserPrompt(fileDiffs, pr) {
  const fileSection = fileDiffs
    .map(
      (f) =>
        `### File: ${f.filename} (${f.status})\n` +
        `+${f.additions} / -${f.deletions}\n` +
        "```diff\n" +
        f.diff +
        "\n```"
    )
    .join("\n\n");

  return (
    `## Pull Request\n` +
    `**Title:** ${pr.title}\n` +
    `**Description:** ${pr.body || "No description provided."}\n` +
    `**Branch:** ${pr.head.ref} → ${pr.base.ref}\n\n` +
    `## Changed Files\n\n${fileSection}\n\n` +
    `## Response Schema\n` +
    `Respond with a JSON object matching this schema:\n` +
    "```json\n" +
    JSON.stringify(
      {
        issues: [
          {
            file: "path/to/file.js",
            line: 42,
            severity: "critical | warning | suggestion",
            category: "bugs | security | performance | style | best_practices",
            comment: "Concise description of the issue.",
          },
        ],
      },
      null,
      2
    ) +
    "\n```\n" +
    `If no issues are found, return: { "issues": [] }`
  );
}

/**
 * Maps AI issues to GitHub pull request review comments.
 * Only includes comments on lines that exist in the diff.
 */
function mapToGitHubComments(issues, files) {
  const comments = [];

  // Build a lookup of valid diff lines per file
  const validLines = new Map();
  for (const file of files) {
    if (file.patch) {
      const lines = extractDiffLineNumbers(file.patch);
      validLines.set(file.filename, lines);
    }
  }

  for (const issue of issues) {
    const fileLines = validLines.get(issue.file);
    if (!fileLines) continue;

    // Find the closest valid line in the diff
    let targetLine = issue.line;
    if (!fileLines.has(targetLine)) {
      // Find nearest valid line
      let closest = null;
      let minDist = Infinity;
      for (const line of fileLines) {
        const dist = Math.abs(line - targetLine);
        if (dist < minDist) {
          minDist = dist;
          closest = line;
        }
      }
      if (closest && minDist <= 5) {
        targetLine = closest;
      } else {
        continue; // Skip if no close line found
      }
    }

    const severityIcon =
      issue.severity === "critical"
        ? "🔴"
        : issue.severity === "warning"
        ? "🟡"
        : "🔵";

    const categoryLabel = issue.category
      ? `**[${issue.category}]** `
      : "";

    comments.push({
      path: issue.file,
      line: targetLine,
      side: "RIGHT",
      body: `${severityIcon} ${categoryLabel}${issue.comment}`,
    });
  }

  return comments;
}

/**
 * Extracts valid line numbers from a unified diff patch.
 * Returns a Set of line numbers on the "new file" side (RIGHT).
 */
function extractDiffLineNumbers(patch) {
  const lines = patch.split("\n");
  const validLines = new Set();
  let currentLine = 0;

  for (const line of lines) {
    // Parse hunk headers: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      // Added line — valid for comment
      validLines.add(currentLine);
      currentLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // Removed line — don't increment new-file line counter
      continue;
    } else {
      // Context line
      currentLine++;
    }
  }

  return validLines;
}

module.exports = { reviewPullRequest };
