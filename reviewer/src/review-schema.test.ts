import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CRITERIA_KEYS,
  type CriterionKey,
  REVIEW_JSON_SCHEMA,
  REVIEWER_PROMPT,
  ReviewResult,
  VERDICT_RULE,
  renderEvalPrompt,
  renderSchemaFile,
  renderVerdictFilter,
  verdictFor,
} from "./review-schema.js";

function criteriaWith(scores: Partial<Record<CriterionKey, number>>): ReviewResult["criteria"] {
  return Object.fromEntries(
    CRITERIA_KEYS.map((key) => [key, { score: scores[key] ?? 7, rationale: key }]),
  ) as ReviewResult["criteria"];
}

const validReview = {
  criteria: Object.fromEntries(CRITERIA_KEYS.map((key) => [key, { score: 7, rationale: `ok (${key})` }])),
  verdict: "pass",
  summary: "**PASS.** Nothing blocking.",
};

describe("ReviewResult", () => {
  it("accepts a review with six scored criteria, a verdict and a summary", () => {
    expect(ReviewResult.safeParse(validReview).success).toBe(true);
  });

  it("rejects a verdict other than pass or fail", () => {
    expect(ReviewResult.safeParse({ ...validReview, verdict: "maybe" }).success).toBe(false);
  });

  it("rejects a review that lacks a criterion", () => {
    const { securitySafety: _dropped, ...fiveCriteria } = validReview.criteria;
    expect(ReviewResult.safeParse({ ...validReview, criteria: fiveCriteria }).success).toBe(false);
  });

  it("rejects a criterion without a rationale", () => {
    const criteria = { ...validReview.criteria, complexity: { score: 5 } };
    expect(ReviewResult.safeParse({ ...validReview, criteria }).success).toBe(false);
  });
});

describe("REVIEW_JSON_SCHEMA", () => {
  const text = JSON.stringify(REVIEW_JSON_SCHEMA);

  it("contains no single quote, because the workflow passes it inside single quotes", () => {
    expect(text).not.toContain("'");
  });

  it("carries no minimum or maximum, which Anthropic structured output rejects", () => {
    expect(text).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum)"/);
  });

  it("requires every criterion, the verdict and the summary", () => {
    expect(REVIEW_JSON_SCHEMA).toMatchObject({
      required: ["criteria", "verdict", "summary"],
      properties: {
        criteria: {
          required: [
            "implementationCorrectness",
            "idiomaticity",
            "complexity",
            "testRiskCoverage",
            "documentation",
            "securitySafety",
          ],
        },
      },
    });
  });
});

describe("REVIEWER_PROMPT", () => {
  it("names all six criteria and states the verdict rule", () => {
    for (const key of CRITERIA_KEYS) {
      expect(REVIEWER_PROMPT).toContain(key);
    }
    expect(REVIEWER_PROMPT).toContain(VERDICT_RULE);
  });

  it("states the verdict rule as a function of the scores", () => {
    expect(VERDICT_RULE).toBe(
      "Return fail if implementationCorrectness <= 5, or securitySafety <= 4, or any criterion <= 3; otherwise return pass.",
    );
  });
});

describe("verdictFor", () => {
  it.each([
    [{}, "pass"],
    [{ implementationCorrectness: 5 }, "fail"],
    [{ implementationCorrectness: 6 }, "pass"],
    [{ securitySafety: 4 }, "fail"],
    [{ securitySafety: 5 }, "pass"],
    [{ documentation: 3 }, "fail"],
    [{ documentation: 4 }, "pass"],
  ] as const)("gives the scores %o the verdict %s, as VERDICT_RULE states", (scores, verdict) => {
    expect(verdictFor(criteriaWith(scores))).toBe(verdict);
  });
});

describe("schema/verdict.jq", () => {
  const filter = fileURLToPath(new URL("../schema/verdict.jq", import.meta.url));

  it("matches the module (run npm run schema:emit after a change)", () => {
    expect(readFileSync(filter, "utf8")).toBe(renderVerdictFilter());
  });

  it("gives the verdict verdictFor gives, for every combination of scores 3 to 6", () => {
    const grid: ReviewResult["criteria"][] = [{} as ReviewResult["criteria"]];
    for (const key of CRITERIA_KEYS) {
      const next: ReviewResult["criteria"][] = [];
      for (const criteria of grid) {
        for (const score of [3, 4, 5, 6]) next.push({ ...criteria, [key]: { score, rationale: key } });
      }
      grid.splice(0, grid.length, ...next);
    }
    const input = grid.map((criteria) => JSON.stringify({ criteria, verdict: "pass", summary: "" })).join("\n");
    const fromJq = execFileSync("jq", ["-r", "-f", filter], { input, encoding: "utf8" }).trimEnd().split("\n");
    expect(fromJq).toHaveLength(4096);
    expect(fromJq).toEqual(grid.map(verdictFor));
  });

  // The schema cannot carry minimum or maximum, so claude-code-action lets a score like 7.5 or 0 through; the
  // workflow runs this filter with jq -er, and an error here stops the job as assertScores stops the agent.
  // A string score prints quoted, so "8" cannot read as a valid 8 in the job log.
  it.each([
    [7.5, "7.5"],
    [0, "0"],
    [11, "11"],
    ["8", '"8"'],
  ] as const)("stops on a score of %j, naming the criterion", (score, shown) => {
    const criteria = Object.fromEntries(CRITERIA_KEYS.map((key) => [key, { score: 8, rationale: key }]));
    criteria.idiomaticity = { score, rationale: "idiomaticity" } as (typeof criteria)[string];
    const input = JSON.stringify({ criteria, verdict: "pass", summary: "" });
    let stderr = "";
    try {
      execFileSync("jq", ["-er", "-f", filter], { input, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr);
    }
    expect(stderr).toContain(`criterion idiomaticity has score ${shown}; expected an integer from 1 to 10`);
  });
});

describe("renderEvalPrompt", () => {
  it("carries the rubric, then the schema the raw promptfoo providers do not enforce, then one diff slot", () => {
    const prompt = renderEvalPrompt();
    const rubricEnd = prompt.indexOf(REVIEWER_PROMPT) + REVIEWER_PROMPT.length;
    const schemaAt = prompt.indexOf(JSON.stringify(REVIEW_JSON_SCHEMA));
    expect(prompt.indexOf(REVIEWER_PROMPT)).toBe(0);
    expect(schemaAt).toBeGreaterThan(rubricEnd);
    expect(prompt.match(/\{\{\s*diff\s*\}\}/g)).toHaveLength(1);
    expect(prompt.indexOf("{{diff}}")).toBeGreaterThan(schemaAt);
  });

  it("keeps the schema free of {{ and {%, which promptfoo would read as Nunjucks tags", () => {
    expect(JSON.stringify(REVIEW_JSON_SCHEMA)).not.toMatch(/\{\{|\{%/);
  });
});

describe("committed contract files", () => {
  it("schema/review-schema.json matches the module (run npm run schema:emit after a change)", () => {
    const committed = readFileSync(new URL("../schema/review-schema.json", import.meta.url), "utf8");
    expect(committed).toBe(renderSchemaFile());
  });

  it("schema/reviewer-prompt.md matches the module (run npm run schema:emit after a change)", () => {
    const committed = readFileSync(new URL("../schema/reviewer-prompt.md", import.meta.url), "utf8");
    expect(committed).toBe(`${REVIEWER_PROMPT}\n`);
  });

  it("evals/prompts/review.txt matches the module (run npm run schema:emit after a change)", () => {
    const committed = readFileSync(new URL("../evals/prompts/review.txt", import.meta.url), "utf8");
    expect(committed).toBe(renderEvalPrompt());
  });
});
