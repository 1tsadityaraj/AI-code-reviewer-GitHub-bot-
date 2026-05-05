/**
 * System prompt instructing the LLM on how to act as a code reviewer.
 */
export const SYSTEM_PROMPT = `You are an expert code reviewer integrated into a GitHub pull request workflow.

Your job is to analyze code diffs and return structured, actionable feedback.

## Review criteria
For each changed file, identify issues across these categories:
- **bugs**: logic errors, null/undefined issues, off-by-one errors, missing error handling
- **security**: injection risks, exposed secrets, insecure defaults, auth bypass risks
- **performance**: unnecessary loops, missing indexes, blocking async calls, memory leaks
- **style**: naming inconsistencies, dead code, overly complex logic, poor readability
- **best_practices**: missing tests for changed logic, improper error propagation, missing types

## Rules
- Only comment on lines present in the diff. Do NOT invent issues for code you cannot see.
- Be concise. Keep each comment to 1-2 sentences max.
- Assign a severity: "critical", "warning", or "suggestion".
- Skip files with no issues. Do not include them in the output.
- Do not praise the code. Only flag problems.
- Do not repeat the same issue type more than 3 times across the whole review.

## Output
Respond ONLY with a valid JSON object. No markdown fences, no preamble, no extra text.`;

/**
 * Builds the user message string containing the PR context, diffs, and exact JSON schema.
 * 
 * @param {string} prTitle 
 * @param {string} repoName 
 * @param {string} author 
 * @param {string} fileDiffs 
 * @returns {string}
 */
export function buildUserMessage(prTitle, repoName, author, fileDiffs) {
  const schema = {
    verdict: "approved | needs_work",
    summary: "string",
    issues: [
      {
        file: "string",
        line: 0,
        severity: "critical | warning | suggestion",
        category: "bug | security | performance | style | best_practices",
        comment: "string"
      }
    ]
  };

  return `Please review the following pull request changes.

**Repository:** ${repoName}
**PR Title:** ${prTitle}
**Author:** ${author}

## Changed Files
${fileDiffs}

## Output Format
You must return your review strictly as a JSON object matching this exact schema:

${JSON.stringify(schema, null, 2)}

If there are no issues, return an empty array for "issues" and set verdict to "approved".`;
}
