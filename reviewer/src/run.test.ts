import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_DIFF_BYTES, runReview } from "./run.js";
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

  it("takes the verdict from the scores and keeps the model's own verdict beside it", async () => {
    const securitySafety = { score: 2, rationale: "src/config.ts:4 logs the API token." };
    const contradicting = { ...passingReview, criteria: { ...passingReview.criteria, securitySafety } };
    const lines: string[] = [];
    const report = await runReview({
      diffSource: diffFile(SOURCE),
      title: "Add a",
      model: mockModel(JSON.stringify(contradicting)),
      log: (line) => lines.push(line),
    });
    expect(report).toMatchObject({ verdict: "fail", modelVerdict: "pass" });
    expect(lines).toContainEqual(expect.stringMatching(/model verdict pass contradicts its scores; the rule gives fail/));
  });

  it("refuses a diff with nothing left to review, before any model call", async () => {
    const model = mockModel(JSON.stringify(passingReview));
    await expect(runReview({ diffSource: diffFile(LOCKFILE), title: "Bump lockfile", model })).rejects.toThrow(
      /nothing to review/,
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("says the diff is empty, not that the exclusion emptied it, when it holds only whitespace", async () => {
    const model = mockModel(JSON.stringify(passingReview));
    const source = diffFile("\n  \n");
    await expect(runReview({ diffSource: source, title: "Add a", model })).rejects.toThrow(
      `nothing to review in ${source}: the diff is empty`,
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  // trimDiff cuts after the last full line that fits, so a first line over the cap leaves nothing, and no exclusion did it.
  it("blames the byte cap, not the exclusion, when the first line of the diff is longer than the cap", async () => {
    const model = mockModel(JSON.stringify(passingReview));
    const source = diffFile(`+${"x".repeat(MAX_DIFF_BYTES)}\n`);
    await expect(runReview({ diffSource: source, title: "Add a", model })).rejects.toThrow(
      `nothing to review in ${source}: its first line is longer than the ${MAX_DIFF_BYTES}-byte cap`,
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
