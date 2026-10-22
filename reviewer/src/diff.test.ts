import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readDiff, trimDiff } from "./diff.js";

function fileDiff(path: string, body = "+x\n"): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;
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
