// parseDiff 函数单元测试：验证 unified diff 解析逻辑
import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff-view.js";

const SINGLE_FILE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,5 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
`;

const MULTI_FILE_DIFF = `diff --git a/README.md b/README.md
index 000..111 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Title
+New line
diff --git a/src/app.ts b/src/app.ts
index 222..333 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -5 +5 @@
-old
+new
`;

describe("parseDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parseDiff("   \n\n  ")).toEqual([]);
  });

  it("parses a single-file diff", () => {
    const files = parseDiff(SINGLE_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/foo.ts");
  });

  it("counts additions correctly", () => {
    const files = parseDiff(SINGLE_FILE_DIFF);
    expect(files[0].additions).toBe(2);  // +const y = 3; and +const z = 4;
  });

  it("counts deletions correctly", () => {
    const files = parseDiff(SINGLE_FILE_DIFF);
    expect(files[0].deletions).toBe(1);  // -const y = 2;
  });

  it("does not count +++ or --- header lines as additions/deletions", () => {
    const files = parseDiff(SINGLE_FILE_DIFF);
    // +++ and --- are file headers, not content changes
    const headerLines = files[0].lines.filter(l => l.startsWith("+++") || l.startsWith("---"));
    expect(headerLines.length).toBeGreaterThan(0);
    // additions should only count real + lines, not +++ header
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
  });

  it("parses multiple files", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("README.md");
    expect(files[1].path).toBe("src/app.ts");
  });

  it("multi-file: correct counts per file", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    expect(files[0].additions).toBe(1);   // README: +New line
    expect(files[0].deletions).toBe(0);
    expect(files[1].additions).toBe(1);   // app.ts: +new
    expect(files[1].deletions).toBe(1);   // app.ts: -old
  });

  it("extracts path from 'diff --git' line", () => {
    const diff = "diff --git a/path/to/deep/file.ts b/path/to/deep/file.ts\n";
    const files = parseDiff(diff);
    expect(files[0].path).toBe("path/to/deep/file.ts");
  });

  it("lines array contains all raw lines for the file", () => {
    const files = parseDiff(SINGLE_FILE_DIFF);
    // The first line of each file starts with "diff --git"
    expect(files[0].lines[0]).toMatch(/^diff --git/);
  });
});

describe("parseDiff: dashboard routing URL format", () => {
  // 验证 project path 编码规则与路由一致
  it("project path encoding: slashes become dashes", () => {
    const projectPath = "/home/user/myproject";
    const encoded = projectPath.replace(/\//g, "-");
    expect(encoded).toBe("-home-user-myproject");
  });

  it("encoded path combined with sessionId forms valid hash route", () => {
    const projectPath = "/home/user/myproject";
    const sessionId = "abc-123-def";
    const encoded = projectPath.replace(/\//g, "-");
    const hash = `#/viewer/${encoded}/${sessionId}`;
    expect(hash).toBe("#/viewer/-home-user-myproject/abc-123-def");
    // 路由器格式：/viewer/:project/:sessionId（两段 path 参数）
    const parts = hash.replace("#/viewer/", "").split("/");
    expect(parts[0]).toBe(encoded);
    expect(parts[1]).toBe(sessionId);
  });
});
