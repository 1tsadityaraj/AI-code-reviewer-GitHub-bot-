import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseDiff } from '../src/parser.js';

describe('parseDiff', () => {
  test('parses a simple JS diff correctly', () => {
    const rawDiff = `diff --git a/index.js b/index.js
index abc..def 100644
--- a/index.js
+++ b/index.js
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 console.log(a, b);`;

    const result = parseDiff(rawDiff);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].filename, 'index.js');
    assert.strictEqual(result[0].language, 'javascript');
    assert.strictEqual(result[0].hunks.length, 1);
    
    const hunk = result[0].hunks[0];
    assert.strictEqual(hunk.header, '@@ -1,3 +1,4 @@');
    assert.strictEqual(hunk.lines.length, 5);
    
    assert.deepStrictEqual(hunk.lines[0], { type: 'context', content: 'const a = 1;', lineNumber: 1 });
    assert.deepStrictEqual(hunk.lines[1], { type: 'remove', content: 'const b = 2;', lineNumber: 2 });
    assert.deepStrictEqual(hunk.lines[2], { type: 'add', content: 'const b = 3;', lineNumber: 2 });
    assert.deepStrictEqual(hunk.lines[3], { type: 'add', content: 'const c = 4;', lineNumber: 3 });
    assert.deepStrictEqual(hunk.lines[4], { type: 'context', content: 'console.log(a, b);', lineNumber: 4 });
  });

  test('skips lock files and images', () => {
    const rawDiff = `diff --git a/package-lock.json b/package-lock.json
index abc..def 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,2 +1,2 @@
 {
-  "version": "1.0.0"
+  "version": "1.0.1"
 }
diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;

    const result = parseDiff(rawDiff);
    assert.strictEqual(result.length, 0);
  });

  test('handles empty or invalid diff gracefully', () => {
    assert.deepStrictEqual(parseDiff(''), []);
    assert.deepStrictEqual(parseDiff(null), []);
    assert.deepStrictEqual(parseDiff(undefined), []);
  });
});
