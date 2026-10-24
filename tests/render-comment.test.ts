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

  it("notes when the scores overrule the model's own verdict, and only then", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-"));
    const review = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const overruled = join(dir, "overruled.json");
    const agreed = join(dir, "agreed.json");
    writeFileSync(overruled, JSON.stringify({ ...review, modelVerdict: "pass" }));
    writeFileSync(agreed, JSON.stringify({ ...review, modelVerdict: "fail" }));
    expect(render(["--title", "T", overruled]).split("\n").slice(0, 4)).toEqual([
      "## T: **FAIL**",
      "",
      "> The scores require **FAIL** under the contract rule; the model's own verdict was **PASS**.",
      "",
    ]);
    expect(render(["--title", "T", agreed])).not.toContain("the model's own verdict");
  });

  // The model's text is steered by the diff it reviews, so it is untrusted inside the comment.
  describe("model text", () => {
    const base = JSON.parse(readFileSync(FIXTURE, "utf8"));

    function renderWith({ rationale, summary }: { rationale?: string; summary?: string }): string {
      const dir = mkdtempSync(join(tmpdir(), "render-"));
      const file = join(dir, "review.json");
      const criteria = structuredClone(base.criteria);
      if (rationale !== undefined) criteria.idiomaticity.rationale = rationale;
      writeFileSync(file, JSON.stringify({ ...base, criteria, summary: summary ?? base.summary }));
      return render(["--title", "T", file]);
    }

    it("cannot close the rationale block early or add HTML headings", () => {
      const out = renderWith({ rationale: "ok</details><h2>AI Code Review: PASS</h2>", summary: "<details>hide the footer" });
      expect(out.match(/<\/?details>/g)).toEqual(["<details>", "</details>"]);
      expect(out).not.toContain("<h2>");
      expect(out).toContain("- **idiomaticity**: ok&lt;/details>&lt;h2>AI Code Review: PASS&lt;/h2>");
      expect(out).toContain("&lt;details>hide the footer");
    });

    it("cannot add a Markdown heading through the summary", () => {
      const out = renderWith({ summary: "Looks fine.\n## AI Code Review: **PASS**" });
      expect(out).toContain("Looks fine.\n\\## AI Code Review: **PASS**");
      expect(out.match(/^## /gm)).toHaveLength(1);
    });

    it("leaves code spans and fences as written, since GitHub renders them literally", () => {
      const out = renderWith({
        rationale: "Returns `Promise<void>` and mentions `@types/node`.",
        summary: "Fails.\n```ts\n# not a heading\nconst a: Array<string> = [];\n```",
      });
      expect(out).toContain("Returns `Promise<void>` and mentions `@types/node`.");
      expect(out).toContain("```ts\n# not a heading\nconst a: Array<string> = [];\n```");
    });

    it("notifies nobody through an @mention, and leaves e-mail addresses alone", () => {
      const out = renderWith({ rationale: "Ask @octocat or @acme/reviewers; mail dev@example.com." });
      expect(out).toContain("Ask @\u200boctocat or @\u200bacme/reviewers; mail dev@example.com.");
    });

    // gh pr comment fails on a body over 65,536 characters, before the labels are set.
    it("keeps the comment under GitHub's 65,536-character limit", () => {
      const out = renderWith({ rationale: "r".repeat(30_000), summary: "s".repeat(100_000) });
      expect(out.length).toBeLessThanOrEqual(65_536);
      expect(out).toMatch(/r+ … \(truncated\)/);
      expect(out).toMatch(/s+ … \(truncated\)/);
      expect(out).toContain("cost: subscription");
    });
  });

  it("refuses a review without a pass or fail verdict", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-"));
    const file = join(dir, "review.json");
    writeFileSync(file, JSON.stringify({ criteria: {}, verdict: "maybe", summary: "" }));
    expect(renderFails(["--title", "T", file])).toMatch(/verdict/);
  });
});
