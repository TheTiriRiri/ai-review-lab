import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = ".github/scripts/render-comment.mjs";
const FIXTURE = "tests/fixtures/review-fail.json";

function render(args: string[]): string {
  return execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
}

function renderFails(args: string[]): string {
  try {
    execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  throw new Error("expected the renderer to exit non-zero");
}

describe("render-comment.mjs", () => {
  it("leads with the title and the verdict in capitals", () => {
    const out = render(["--title", "AI Code Review (test)", FIXTURE]);
    expect(out.split("\n")[0]).toBe("## AI Code Review (test): **FAIL**");
  });

  it("lists all six criteria with their scores in a table", () => {
    const out = render(["--title", "T", FIXTURE]);
    expect(out).toContain("| Criterion | Score |");
    expect(out).toContain("| implementationCorrectness | 4 |");
    expect(out).toContain("| securitySafety | 2 |");
    expect(out.match(/^\| [a-zA-Z]+ \| \d+ \|$/gm)).toHaveLength(6);
  });

  it("puts every rationale inside a collapsed details block", () => {
    const out = render(["--title", "T", FIXTURE]);
    const details = out.slice(out.indexOf("<details>"), out.indexOf("</details>"));
    expect(details).toContain("**testRiskCoverage**: Only a happy-path test for orderBy.");
  });

  it("includes the model summary", () => {
    expect(render(["--title", "T", FIXTURE])).toContain("`orderBy` concatenates caller input");
  });

  it("shows subscription as the cost when the review carries no meta", () => {
    const out = render(["--title", "T", "--run-url", "https://example.test/run/1", FIXTURE]);
    expect(out).toContain("cost: subscription");
    expect(out).toContain("[run](https://example.test/run/1)");
  });

  it("shows model, duration and cost from meta when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-"));
    const file = join(dir, "review.json");
    const review = JSON.parse(readFileSync(FIXTURE, "utf8"));
    writeFileSync(file, JSON.stringify({ ...review, meta: { model: "z-ai/glm-5.3", durationMs: 4210, costUsd: 0.00312 } }));
    const out = render(["--title", "T", file]);
    expect(out).toContain("model: z-ai/glm-5.3");
    expect(out).toContain("duration: 4.2 s");
    expect(out).toContain("cost: $0.0031");
  });

  it("refuses a review without a pass or fail verdict", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-"));
    const file = join(dir, "review.json");
    writeFileSync(file, JSON.stringify({ criteria: {}, verdict: "maybe", summary: "" }));
    expect(renderFails(["--title", "T", file])).toMatch(/verdict/);
  });
});
