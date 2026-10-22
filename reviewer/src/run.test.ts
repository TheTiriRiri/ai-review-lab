import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runReview } from "./run.js";
import { mockModel, passingReview } from "./testing/mock-model.js";

const SOURCE = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+export const a = 1;\n";
const LOCKFILE =
  "diff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n" +
  '@@ -1 +1 @@\n+"lockfileVersion": 3\n';

function diffFile(text: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "run-")), "pr.diff");
  writeFileSync(file, text);
  return file;
}

describe("runReview", () => {
  it("reviews the diff without the lockfile and reports the run in meta", async () => {
    const model = mockModel(JSON.stringify(passingReview), { openrouter: { usage: { cost: 0.0031 } } });
    const report = await runReview({ diffSource: diffFile(SOURCE + LOCKFILE), title: "Add a", model });
    expect(report).toMatchObject({
      ...passingReview,
      meta: {
        model: "mock-model-id",
        costUsd: 0.0031,
        inputTokens: 1200,
        outputTokens: 300,
        truncated: false,
        excludedFiles: ["package-lock.json"],
      },
    });
    expect(report.meta.durationMs).toBeGreaterThanOrEqual(0);
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(sent).toContain("export const a = 1;");
    expect(sent).not.toContain("lockfileVersion");
  });

  it("refuses a diff with nothing left to review, before any model call", async () => {
    const model = mockModel(JSON.stringify(passingReview));
    await expect(runReview({ diffSource: diffFile(LOCKFILE), title: "Bump lockfile", model })).rejects.toThrow(
      /nothing to review/,
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
