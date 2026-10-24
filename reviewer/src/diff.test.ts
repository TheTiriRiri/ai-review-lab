import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readDiff, trimDiff } from "./diff.js";

function fileDiff(path: string, body = "+x\n"): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;
}

// How git (default core.quotePath) prints a path with a non-ASCII byte, a double quote or a backslash.
function quotedFileDiff(quoted: string, body = "+x\n"): string {
  return `diff --git "a/${quoted}" "b/${quoted}"\n--- "a/${quoted}"\n+++ "b/${quoted}"\n@@ -1 +1 @@\n${body}`;
}

describe("trimDiff", () => {
  it("returns a diff that fits unchanged", () => {
    const diff = fileDiff("src/a.ts");
    expect(trimDiff(diff, { maxBytes: 10_000 })).toEqual({ diff, excludedFiles: [], truncated: false });
  });

  it("drops every file whose path matches an exclude glob, keeping the rest whole", () => {
    const diff = fileDiff("src/a.ts") + fileDiff("package-lock.json", "+lock\n") + fileDiff("src/b.ts");
    expect(trimDiff(diff, { maxBytes: 10_000, excludeGlobs: ["package-lock.json"] })).toEqual({
      diff: fileDiff("src/a.ts") + fileDiff("src/b.ts"),
      excludedFiles: ["package-lock.json"],
      truncated: false,
    });
  });

  it("lets ** cross directories, or none, while * and ? stay inside one", () => {
    const paths = [
      "package-lock.json",
      "packages/x/package-lock.json",
      "dist/index.js",
      "src/dist.ts",
      "yarn.lock",
      "sub/yarn.lock",
    ];
    const { excludedFiles } = trimDiff(paths.map((path) => fileDiff(path)).join(""), {
      maxBytes: 10_000,
      excludeGlobs: ["**/package-lock.json", "dist/**", "*.lock", "src/?.ts"],
    });
    expect(excludedFiles).toEqual(["package-lock.json", "packages/x/package-lock.json", "dist/index.js", "yarn.lock"]);
  });

  it("keeps a file whose path git quotes, even right after an excluded file", () => {
    const quoted = quotedFileDiff(String.raw`src/za\305\274\303\263\305\202\304\207.ts`);
    expect(trimDiff(fileDiff("package-lock.json", "+lock\n") + quoted, { maxBytes: 10_000, excludeGlobs: ["**/package-lock.json"] })).toEqual({
      diff: quoted,
      excludedFiles: ["package-lock.json"],
      truncated: false,
    });
  });

  it("matches exclude globs against the decoded path of a quoted header", () => {
    const diff = fileDiff("src/a.ts") + quotedFileDiff(String.raw`zesp\303\263\305\202/package-lock.json`, "+lock\n");
    expect(trimDiff(diff, { maxBytes: 10_000, excludeGlobs: ["**/package-lock.json"] })).toEqual({
      diff: fileDiff("src/a.ts"),
      excludedFiles: ["zespół/package-lock.json"],
      truncated: false,
    });
  });

  it("decodes escaped quotes and backslashes in a quoted path", () => {
    const { excludedFiles } = trimDiff(quotedFileDiff(String.raw`say \"hi\" \\ bye.txt`), {
      maxBytes: 10_000,
      excludeGlobs: ["*.txt"],
    });
    expect(excludedFiles).toEqual(['say "hi" \\ bye.txt']);
  });

  it("takes the new path when only one side of a rename is quoted", () => {
    const rename = String.raw`diff --git "a/caf\303\251.txt" b/cafe.txt` + "\nsimilarity index 100%\n";
    expect(trimDiff(rename, { maxBytes: 10_000, excludeGlobs: ["*.txt"] }).excludedFiles).toEqual(["cafe.txt"]);
  });

  it("starts a new file at every diff --git line and keeps one whose header it cannot read", () => {
    const unreadable = "diff --git a/only-one-path\n+x\n";
    expect(trimDiff(fileDiff("package-lock.json") + unreadable, { maxBytes: 10_000, excludeGlobs: ["**/package-lock.json"] })).toEqual({
      diff: unreadable,
      excludedFiles: ["package-lock.json"],
      truncated: false,
    });
  });

  it("cuts at the last full line that fits and reports the truncation", () => {
    expect(trimDiff("line1\nline2\nline3\n", { maxBytes: 14 })).toEqual({
      diff: "line1\nline2\n",
      excludedFiles: [],
      truncated: true,
    });
  });

  it("measures the limit in UTF-8 bytes, not characters", () => {
    // Each line is 8 characters but 12 bytes, so two lines (16 characters, 24 bytes) do not fit in 20.
    expect(trimDiff("+zażółć\n+zażółć\n", { maxBytes: 20 }).diff).toBe("+zażółć\n");
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => trimDiff("x\n", { maxBytes: 0 })).toThrow(/maxBytes/);
    expect(() => trimDiff("x\n", { maxBytes: 1.5 })).toThrow(/maxBytes/);
  });
});

describe("readDiff", () => {
  it("reads a diff from a file", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "diff-")), "pr.diff");
    writeFileSync(file, fileDiff("src/a.ts"));
    await expect(readDiff(file)).resolves.toBe(fileDiff("src/a.ts"));
  });

  it("reads standard input whole, so a character split across chunks survives", async () => {
    const stdin = Readable.from([Buffer.from("+za"), Buffer.from([0xc5]), Buffer.from([0xbc, 0x0a])]);
    await expect(readDiff("stdin", stdin)).resolves.toBe("+zaż\n");
  });
});
