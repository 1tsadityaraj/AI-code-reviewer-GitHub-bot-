export function parseDiff(rawDiff) {
  if (!rawDiff || typeof rawDiff !== 'string') return [];

  const SKIP_FILES = [
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i,
    /\.(woff|woff2|ttf|eot)$/i,
    /\.(pdf|zip|tar|gz)$/i
  ];

  const files = [];
  // Split the raw diff into per-file chunks based on "diff --git"
  const fileChunks = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    
    // Extract filename from header
    const headerMatch = lines[0].match(/^a\/(.+?)\s+b\/(.+)$/);
    if (!headerMatch) continue;
    
    const filename = headerMatch[2];

    // Skip if binary or lock file
    if (SKIP_FILES.some(regex => regex.test(filename))) continue;
    
    // Check if it's explicitly marked as a binary file in the diff
    if (chunk.includes('Binary files ')) continue;

    const language = getLanguageFromExtension(filename);
    const hunks = [];
    let currentHunk = null;
    let oldLineCounter = 0;
    let newLineCounter = 0;

    // Find where the hunk starts
    const patchStartIndex = lines.findIndex(line => line.startsWith('@@ '));
    if (patchStartIndex === -1) continue; // No hunks (e.g. permission change only)

    for (let i = patchStartIndex; i < lines.length; i++) {
      const line = lines[i];

      const hunkHeaderMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (hunkHeaderMatch) {
        currentHunk = {
          header: line,
          lines: []
        };
        hunks.push(currentHunk);
        oldLineCounter = parseInt(hunkHeaderMatch[1], 10);
        newLineCounter = parseInt(hunkHeaderMatch[2], 10);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.substring(1),
          lineNumber: newLineCounter
        });
        newLineCounter++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({
          type: 'remove',
          content: line.substring(1),
          lineNumber: oldLineCounter
        });
        oldLineCounter++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
          lineNumber: newLineCounter
        });
        oldLineCounter++;
        newLineCounter++;
      } else if (line === '\\ No newline at end of file') {
         // Ignore this standard git message
         continue;
      }
    }

    files.push({
      filename,
      language,
      hunks
    });
  }

  return files;
}

function getLanguageFromExtension(filename) {
  const extMatch = filename.match(/\.([^.]+)$/);
  if (!extMatch) return 'unknown';
  
  const ext = extMatch[1].toLowerCase();
  const map = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'go': 'go',
    'java': 'java',
    'rb': 'ruby',
    'rs': 'rust',
    'c': 'c',
    'cpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'md': 'markdown',
    'sh': 'bash',
    'yaml': 'yaml',
    'yml': 'yaml'
  };
  
  return map[ext] || ext;
}
