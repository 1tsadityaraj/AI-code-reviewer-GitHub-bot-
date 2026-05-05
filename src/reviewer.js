/**
 * AI Review Engine
 *
 * Orchestrates the review pipeline: fetches diff → parses files →
 * sends to Gemini for analysis → validates with Zod → maps to inline comments.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { parseDiff } from "./parser.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

// ── Configuration ─────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_REVIEW || "15", 10);
const MAX_DIFF_SIZE = parseInt(process.env.MAX_DIFF_SIZE || "12000", 10);

// ── Zod schemas for validating Gemini output ──────────────────
const IssueSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  severity: z.enum(["critical", "warning", "suggestion"]),
  category: z.enum(["bug", "security", "performance", "style", "best_practices"]),
  comment: z.string().max(500),
});

const ReviewResponseSchema = z.object({
  verdict: z.enum(["approved", "needs_work"]),
  summary: z.string(),
  issues: z.array(IssueSchema),
});

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
 * @param {import('probot').Context} context
 * @param {object}                   pr
 * @returns {Promise<ReviewResult>}
 */
export async function reviewPullRequest(context, pr) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const repo = context.repo();

  // 1. Fetch raw diff
  const { data: diff } = await context.octokit.pulls.get({
    ...repo,
    pull_number: pr.number,
    mediaType: { format: "diff" },
  });

  // 2. Parse into per-file hunks
  const files = parseDiff(diff);

  // 3. Filter irrelevant files
  const reviewableFiles = files
    .filter((f) => !SKIP_PATTERNS.some((p) => p.test(f.filename)))
    .filter((f) => f.additions > 0)
    .slice(0, MAX_FILES);

  if (reviewableFiles.length === 0) {
    return emptyResult();
  }

  // 4. Build per-file diffs for AI
  const fileDiffsStr = reviewableFiles.map((file) => {
    let diffContent = file.patch || "";
    if (diffContent.length > MAX_DIFF_SIZE) {
      diffContent =
        diffContent.substring(0, MAX_DIFF_SIZE) +
        "\n... [diff truncated]";
    }
    return `### File: ${file.filename} (${file.status})\n+${file.additions} / -${file.deletions}\n\`\`\`diff\n${diffContent}\n\`\`\``;
  }).join("\n\n");

  // 5. Call Gemini
  const repoName = `${repo.owner}/${repo.repo}`;
  const author = pr.user.login;
  const reviewData = await callGemini(pr.title, repoName, author, fileDiffsStr);
  const issues = reviewData.issues;

  // 6. Map to GitHub review comments
  const comments = mapToGitHubComments(issues, reviewableFiles);

  // 7. Count severities
  let criticalCount = 0;
  let warningCount = 0;
  let suggestionCount = 0;

  for (const issue of issues) {
    if (issue.severity === "critical") criticalCount++;
    else if (issue.severity === "warning") warningCount++;
    else suggestionCount++;
  }

  return {
    verdict: reviewData.verdict,
    summary: reviewData.summary,
    comments,
    hasCritical: criticalCount > 0,
    criticalCount,
    warningCount,
    suggestionCount,
    filesReviewed: reviewableFiles.length,
  };
}

/**
 * Sends file diffs to Google Gemini and validates the response with Zod.
 */
async function callGemini(prTitle, repoName, author, fileDiffs) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.3,
      topP: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  const userPrompt = buildUserMessage(prTitle, repoName, author, fileDiffs);

  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    { text: userPrompt },
  ]);

  const raw = result.response.text();

  try {
    const parsed = JSON.parse(raw);

    // Validate with Zod
    const validated = ReviewResponseSchema.safeParse(parsed);

    if (!validated.success) {
      console.error("Zod validation failed:", validated.error.format());
      
      // Attempt partial recovery — keep valid properties where possible
      return {
        verdict: ["approved", "needs_work"].includes(parsed.verdict) ? parsed.verdict : "approved",
        summary: typeof parsed.summary === "string" ? parsed.summary : "Review processed with validation errors.",
        issues: (parsed.issues || []).filter(
          (i) => IssueSchema.safeParse(i).success
        )
      };
    }

    return validated.data;
  } catch (err) {
    console.error("Failed to parse Gemini response:", err.message);
    return { verdict: "approved", summary: "Failed to parse AI response.", issues: [] };
  }
}

/**
 * Maps validated AI issues to GitHub PR review comments.
 * Only includes comments on lines present in the diff.
 */
function mapToGitHubComments(issues, files) {
  const comments = [];

  const validLines = new Map();
  for (const file of files) {
    if (file.patch) {
      validLines.set(file.filename, extractDiffLineNumbers(file.patch));
    }
  }

  for (const issue of issues) {
    const fileLines = validLines.get(issue.file);
    if (!fileLines) continue;

    let targetLine = issue.line;

    if (!fileLines.has(targetLine)) {
      // Snap to nearest valid diff line within 5-line tolerance
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
        continue;
      }
    }

    const icon =
      issue.severity === "critical" ? "🔴" :
      issue.severity === "warning" ? "🟡" : "🔵";

    comments.push({
      path: issue.file,
      line: targetLine,
      side: "RIGHT",
      body: `${icon} **[${issue.category}]** ${issue.comment}`,
    });
  }

  return comments;
}

/**
 * Extracts valid new-file line numbers from a unified diff patch.
 */
function extractDiffLineNumbers(patch) {
  const lines = patch.split("\n");
  const valid = new Set();
  let current = 0;

  for (const line of lines) {
    const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      current = parseInt(hunk[1], 10);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      valid.add(current);
      current++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // Deleted line — don't increment new-file counter
    } else {
      current++;
    }
  }

  return valid;
}

function emptyResult() {
  return {
    verdict: "approved",
    summary: "No files matched the review criteria.",
    comments: [],
    hasCritical: false,
    criticalCount: 0,
    warningCount: 0,
    suggestionCount: 0,
    filesReviewed: 0,
  };
}
