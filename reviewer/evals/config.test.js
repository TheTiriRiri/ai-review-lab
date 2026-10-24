import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

// js-yaml is the parser promptfoo itself loads the config with, so these tests read what promptfoo reads.
const config = load(readFileSync(new URL("./promptfooconfig.yaml", import.meta.url), "utf8"));
const grader = config.defaultTest.options.provider;
const reviewers = config.providers;

// promptfoo's OpenRouter provider sends max_tokens 1024 unless told otherwise, and reasoning models spend that on
// thinking before the JSON starts; the CI reviewer used up to 8,895 output tokens on a 2 KB fixture.
const REVIEW_MAX_TOKENS = 16_384;
const GRADER_MAX_TOKENS = 4_096;

const javascriptAssertions = config.tests.flatMap((test) =>
  test.assert.filter((a) => a.type === "javascript").map((a) => [test.description, a.value]),
);

function review(verdict, score) {
  const criteria = Object.fromEntries(
    ["implementationCorrectness", "idiomaticity", "complexity", "testRiskCoverage", "documentation", "securitySafety"].map(
      (name) => [name, { score, rationale: "r" }],
    ),
  );
  return JSON.stringify({ criteria, verdict, summary: "s" });
}

describe("promptfoo config", () => {
  it.each(reviewers.map((p) => [p.id, p]))("%s has room to finish the review", (_id, provider) => {
    expect(provider.config?.max_tokens).toBeGreaterThanOrEqual(REVIEW_MAX_TOKENS);
  });

  it("gives the llm-rubric grader room to finish its verdict", () => {
    expect(grader.config?.max_tokens).toBeGreaterThanOrEqual(GRADER_MAX_TOKENS);
  });

  // With showThinking on (the default), the provider prefixes the output with "Thinking: <reasoning>", so is-json
  // and the javascript assertions grade the reasoning instead of the review.
  it.each([...reviewers, grader].map((p) => [p.id, p]))("%s keeps reasoning out of the output", (_id, provider) => {
    expect(provider.config?.showThinking).toBe(false);
  });

  // A one-line value is rewritten by promptfoo (buildFunctionBody inserts its own return), which broke every
  // "const r = ...; return ..." assertion; a multi-line value is used as the function body as written.
  it.each(javascriptAssertions)("the javascript assertion of %s runs as written", (_name, body) => {
    expect(body).toContain("\n");
    const assertion = new Function("output", "context", "process", body);
    const onFail = assertion(review("fail", 1), {}, {});
    const onPass = assertion(review("pass", 10), {}, {});
    expect(typeof onFail).toBe("boolean");
    expect(onFail).not.toBe(onPass);
  });
});
