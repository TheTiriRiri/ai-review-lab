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

  // The reviewer leaves costUsd out of meta when OpenRouter reports no cost; that is unknown, not free.
  it("shows n/a as the cost when meta carries none", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-"));
    const file = join(dir, "review.json");
    const review = JSON.parse(readFileSync(FIXTURE, "utf8"));
    writeFileSync(file, JSON.stringify({ ...review, meta: { model: "z-ai/glm-5.3", durationMs: 4210, costUsd: undefined } }));
    expect(render(["--title", "T", file])).toContain("cost: n/a");
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
      const out = renderWith({
        rationale: "ok</details><h2>AI Code Review: PASS</h2>",
        summary: "<details>hide the footer <!-- or <?pi",
      });
      expect(out.match(/<\/?details>/g)).toEqual(["<details>", "</details>"]);
      expect(out).not.toContain("<h2>");
      expect(out).toContain("- **idiomaticity**: ok<\u200b/details><\u200bh2>AI Code Review: PASS<\u200b/h2>");
      expect(out).toContain("<\u200bdetails>hide the footer <\u200b!-- or <\u200b?pi");
    });

    it("cannot add a Markdown heading through the summary", () => {
      const out = renderWith({ summary: "Looks fine.\n## AI Code Review: **PASS**" });
      expect(out).toContain("Looks fine.\n\u200b## AI Code Review: **PASS**");
      expect(out.match(/^## /gm)).toHaveLength(1);
    });

    it("cannot add a setext heading, or a heading inside a list item or a quote", () => {
      const out = renderWith({
        summary: "AI Code Review: **PASS**\n===\n\nAlso\n---\n\n- ## AI Code Review: **PASS**\n\n> ## quoted",
      });
      expect(out).toContain(
        "AI Code Review: **PASS**\n\u200b===\n\nAlso\n\u200b---\n\n- \u200b## AI Code Review: **PASS**\n\n> \u200b## quoted",
      );
    });

    function expectNoInjectedTags(out: string): void {
      expect(out.match(/<\/?details>/g)).toEqual(["<details>", "</details>"]);
      expect(out).not.toContain("<h2>");
    }

    // Which backticks pair up into a span is GitHub's call and depends on the block structure around them, so text
    // that looks like a span to a regex is escaped like any other prose.
    it.each([
      ["a longer closing run", { rationale: "see `</details><h2>FAKE PASS</h2>`` here" }],
      ["an escaped opening backtick", { rationale: "\\`</details><h2>FAKE</h2>` tail" }],
      ["a blank line inside the span", { summary: "`a\n\n</details><h2>FAKE</h2>\n\nb`" }],
      ["a list item inside the span", { summary: "`a\n- </details><h2>FAKE</h2> b`" }],
      ["an unpaired backtick earlier in the paragraph", { summary: "` a\n`b`</details><h2>FAKE</h2>`" }],
      ["an indented fence that a fence at column 0 closes", { summary: "Fails.\n\n  ```\n```\n</details><h2>FAKE</h2>\n```" }],
      ["a list item fence that a line at column 0 ends", { summary: "- a\n  ```\n  x\nb\n</details><h2>FAKE</h2>\n  ```" }],
      ["a fence that a CRLF line closes", { summary: "```\r\nA\r\n```\r\n</details><h2>FAKE</h2>\n```\n" }],
    ])("escapes text that only looks like code: %s", (_, text) => {
      expectNoInjectedTags(renderWith(text));
    });

    // CommonMark ends a line at a bare carriage return too, which would start a block of its own below the list item.
    it("keeps a rationale on its one line when it holds a bare carriage return", () => {
      const out = renderWith({ rationale: "a\r```\rb" });
      expect(out).toContain("- **idiomaticity**: a ``` b\n");
      expect(out).not.toContain("\r");
    });

    // A cut code span loses its closing backticks, so GitHub renders what follows the opener as prose.
    it("escapes a code span that the length cap cuts open, and keeps it within the cap", () => {
      const out = renderWith({ summary: `\`${"</details><h2>FAKE</h2>".repeat(2_000)}\`` });
      expectNoInjectedTags(out);
      expect(out).toMatch(/ … \(truncated\)/);
      expect(out.length).toBeLessThan(20_000);
    });

    // A zero-width space renders as nothing inside a code span as well, so a span reads as the model wrote it.
    it("leaves a fenced block as written, and changes a code span only by zero-width spaces", () => {
      const out = renderWith({
        rationale: "Returns `Promise<void>` and mentions `@types/node`.",
        summary: "Fails.\n```ts\n# not a heading\nconst a: Array<string> = [];\n```",
      });
      expect(out).toContain("Returns `Promise<\u200bvoid>` and mentions `@\u200btypes/node`.");
      expect(out).toContain("```ts\n# not a heading\nconst a: Array<string> = [];\n```");
    });

    it("notifies nobody through an @mention, and leaves e-mail addresses alone", () => {
      const out = renderWith({ rationale: "Ask @octocat or @acme/reviewers; mail dev@example.com." });
      expect(out).toContain("Ask @\u200boctocat or @\u200bacme/reviewers; mail dev@example.com.");
    });

    // GitHub decodes an entity into the text before it looks for mentions; other entities stay as written.
    it("notifies nobody through an @ written as an HTML entity", () => {
      const out = renderWith({ rationale: "Ask &#64;octocat, &#x40;hubot, &#064;a or &commat;acme; keep &amp; and &lt;." });
      expect(out).toContain(
        "Ask &\u200b#64;octocat, &\u200b#x40;hubot, &\u200b#064;a or &\u200bcommat;acme; keep &amp; and &lt;.",
      );
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
