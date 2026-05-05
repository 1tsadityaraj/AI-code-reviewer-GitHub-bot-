/**
 * Unit tests for the diff parser module.
 */

const { parseDiff } = require("../src/parser");

describe("parseDiff", () => {
  it("should return empty array for null/undefined input", () => {
    expect(parseDiff(null)).toEqual([]);
    expect(parseDiff(undefined)).toEqual([]);
    expect(parseDiff("")).toEqual([]);
  });

  it("should parse a simple added file diff", () => {
    const diff = `diff --git a/hello.js b/hello.js
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/hello.js
@@ -0,0 +1,3 @@
+const greet = (name) => {
+  console.log("Hello, " + name);
+};
`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("hello.js");
    expect(result[0].status).toBe("added");
    expect(result[0].additions).toBe(3);
    expect(result[0].deletions).toBe(0);
  });

  it("should parse a modified file diff", () => {
    const diff = `diff --git a/utils.js b/utils.js
index abc1234..def5678 100644
--- a/utils.js
+++ b/utils.js
@@ -1,5 +1,5 @@
 function add(a, b) {
-  return a + b;
+  return Number(a) + Number(b);
 }
 
 module.exports = { add };
`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("utils.js");
    expect(result[0].status).toBe("modified");
    expect(result[0].additions).toBe(1);
    expect(result[0].deletions).toBe(1);
  });

  it("should parse multiple files in a single diff", () => {
    const diff = `diff --git a/foo.js b/foo.js
index abc..def 100644
--- a/foo.js
+++ b/foo.js
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 module.exports = { x };
diff --git a/bar.js b/bar.js
new file mode 100644
--- /dev/null
+++ b/bar.js
@@ -0,0 +1,2 @@
+const z = 3;
+module.exports = { z };
`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe("foo.js");
    expect(result[1].filename).toBe("bar.js");
    expect(result[1].status).toBe("added");
  });

  it("should detect deleted files", () => {
    const diff = `diff --git a/old.js b/old.js
deleted file mode 100644
index abc..000 100644
--- a/old.js
+++ /dev/null
@@ -1,3 +0,0 @@
-const old = true;
-module.exports = { old };
-
`;

    const result = parseDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("removed");
    expect(result[0].deletions).toBe(3);
  });
});
