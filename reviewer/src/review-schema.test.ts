import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CRITERIA_KEYS,
  REVIEW_JSON_SCHEMA,
  REVIEWER_PROMPT,
  ReviewResult,
  VERDICT_RULE,
  renderSchemaFile,
} from "./review-schema.js";

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

describe("committed contract files", () => {
  it("schema/review-schema.json matches the module (run npm run schema:emit after a change)", () => {
    const committed = readFileSync(new URL("../schema/review-schema.json", import.meta.url), "utf8");
    expect(committed).toBe(renderSchemaFile());
  });

  it("schema/reviewer-prompt.md matches the module (run npm run schema:emit after a change)", () => {
    const committed = readFileSync(new URL("../schema/reviewer-prompt.md", import.meta.url), "utf8");
    expect(committed).toBe(`${REVIEWER_PROMPT}\n`);
  });
});
