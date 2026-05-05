/**
 * Unified Diff Parser
 *
 * Parses a raw unified diff string (as returned by the GitHub API)
 * into an array of structured file objects with hunks and metadata.
 */

/**
 * Parses a raw unified diff into per-file objects.
 *
 * @param {string} rawDiff  The raw unified diff text
 * @returns {Array<ParsedFile>}
 *
 * @typedef {object} ParsedFile
 * @property {string} filename
 * @property {string} status     "added" | "modified" | "removed" | "renamed"
 * @property {number} additions
 * @property {number} deletions
 * @property {string} patch      The raw patch/hunk content
 */
export function parseDiff(rawDiff) {
  if (!rawDiff || typeof rawDiff !== "string") {
    return [];
  }

  const files = [];
  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const file = parseFileSection(section);
    if (file) files.push(file);
  }

  return files;
}

/**
 * Parses a single file section from a unified diff.
 */
function parseFileSection(section) {
  const lines = section.split("\n");

  const headerMatch = lines[0]?.match(/^a\/(.+?)\s+b\/(.+)/);
  if (!headerMatch) return null;

  const oldPath = headerMatch[1];
  const newPath = headerMatch[2];

  let status = "modified";
  if (section.includes("new file mode")) {
    status = "added";
  } else if (section.includes("deleted file mode")) {
    status = "removed";
  } else if (section.includes("rename from") || oldPath !== newPath) {
    status = "renamed";
  }

  const patchStartIndex = lines.findIndex((line) => line.startsWith("@@"));
  const patch =
    patchStartIndex >= 0 ? lines.slice(patchStartIndex).join("\n") : "";

  let additions = 0;
  let deletions = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }

  return { filename: newPath, status, additions, deletions, patch };
}
