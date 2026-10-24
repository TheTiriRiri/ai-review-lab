import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL, MODEL_ROUTING } from "../src/agent.ts";

// js-yaml is the parser promptfoo itself loads the config with, so these tests read what promptfoo reads.
const config = load(readFileSync(new URL("./promptfooconfig.yaml", import.meta.url), "utf8"));
const grader = config.defaultTest.options.provider;
const reviewers = config.providers;

// promptfoo's OpenRouter provider sends max_tokens 1024 unless told otherwise, and reasoning models spend that on
// thinking before the JSON starts. glm-5.3 used 14,125 of 16,384 on the fixture of PR 3 and in a CI run of eval.yml
// returned an empty review on it; the reviewer agent sends no cap at all.
const REVIEW_MAX_TOKENS = 32_768;
// The gated model used up to 30,415 output tokens on a fixture and once ran out at 32,768.
const GATED_MAX_TOKENS = 65_536;
const GRADER_MAX_TOKENS = 4_096;

const javascriptAssertions = config.tests.flatMap((test) =>
  test.assert.filter((a) => a.type === "javascript").map((a) => [test.description, a.value]),
);

// The criterion names come from the contract, so the canned reviews follow a renamed or added criterion.
const CRITERIA = JSON.parse(readFileSync(new URL("../schema/review-schema.json", import.meta.url), "utf8")).properties
  .criteria.required;

function review(verdict, score) {
  const criteria = Object.fromEntries(CRITERIA.map((name) => [name, { score, rationale: "r" }]));
  return JSON.stringify({ criteria, verdict, summary: "s" });
}

describe("promptfoo config", () => {
  it.each(reviewers.map((p) => [p.id, p]))("%s has room to finish the review", (_id, provider) => {
    expect(provider.config?.max_tokens).toBeGreaterThanOrEqual(REVIEW_MAX_TOKENS);
  });

  // eval.yml gates on this model, so it runs as the reviewer agent sends it (agent.ts), not at the provider default.
  it("runs the model of variant 2 at temperature 0, as the reviewer agent does", () => {
    const gated = reviewers.find((p) => p.id === `openrouter:${DEFAULT_MODEL}`);
    expect(gated?.config?.temperature).toBe(0);
  });

  // Without the same routing, the gate grades whichever upstream provider OpenRouter picks, not the one CI reviews with.
  // Like the agent, it sends no reasoning cap: with one, glm-5.3 reasoned for under 200 tokens and failed half the cases.
  it("routes the model of variant 2 to the providers the reviewer agent pins, without a reasoning cap", () => {
    const gated = reviewers.find((p) => p.id === `openrouter:${DEFAULT_MODEL}`);
    expect(gated?.config?.provider).toEqual(MODEL_ROUTING[DEFAULT_MODEL]?.provider);
    expect(gated?.config?.passthrough?.reasoning).toBeUndefined();
    expect(gated?.config?.max_tokens).toBeGreaterThanOrEqual(GATED_MAX_TOKENS);
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
