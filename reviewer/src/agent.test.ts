import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL, MODEL_ROUTING, reviewDiff } from "./agent.js";
import { REVIEWER_PROMPT } from "./review-schema.js";
import { mockModel, passingReview as review } from "./testing/mock-model.js";

const input = {
  title: "Support negative counts in addBusinessDays",
  body: "Steps backward for a negative count.",
  diff: "diff --git a/src/date-range.ts b/src/date-range.ts\n+const step = days < 0 ? -1 : 1;\n",
};

describe("reviewDiff", () => {
  it("returns the parsed review with usage, cost, duration and the model id", async () => {
    const outcome = await reviewDiff(input, {
      model: mockModel(JSON.stringify(review), { openrouter: { usage: { cost: 0.0042 } } }),
    });
    expect(outcome.result).toEqual(review);
    expect(outcome.costUsd).toBe(0.0042);
    expect(outcome.usage).toMatchObject({ inputTokens: 1200, outputTokens: 300 });
    expect(outcome.model).toBe("mock-model-id");
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the rubric as instructions and the framed pull request as the prompt, at temperature 0", async () => {
    const model = mockModel(JSON.stringify(review));
    await reviewDiff(input, { model });
    expect(model.doGenerateCalls).toHaveLength(1);
    const [call] = model.doGenerateCalls;
    expect(call?.prompt[0]).toEqual({ role: "system", content: REVIEWER_PROMPT });
    expect(JSON.stringify(call?.prompt[1])).toContain("<pr_title>\\nSupport negative counts in addBusinessDays\\n");
    expect(call?.temperature).toBe(0);
    expect(call?.responseFormat).toMatchObject({ type: "json" });
  });

  it("asks OpenRouter for usage accounting, the source of the real cost, and leaves an unlisted model unpinned", async () => {
    const model = mockModel(JSON.stringify(review));
    await reviewDiff(input, { model });
    expect(model.doGenerateCalls[0]?.providerOptions).toEqual({ openrouter: { usage: { include: true } } });
  });

  // OpenRouter spreads a model over many upstream providers and picks one per request by price; for glm-5.3 the
  // cheapest gave shallow reviews and another spent all output tokens on reasoning (docs/comparison.md).
  it("sends the default model only to its pinned providers, with reasoning capped", async () => {
    const model = mockModel(JSON.stringify(review), undefined, DEFAULT_MODEL);
    await reviewDiff(input, { model });
    expect(model.doGenerateCalls[0]?.providerOptions).toEqual({
      openrouter: {
        usage: { include: true },
        provider: { order: ["digitalocean", "sail-research"], allow_fallbacks: false, require_parameters: true },
        reasoning: { max_tokens: 12_000 },
      },
    });
    expect(MODEL_ROUTING[DEFAULT_MODEL]?.provider.order).toEqual(["digitalocean", "sail-research"]);
  });

  it("names the upstream provider that served the review, when OpenRouter reports it", async () => {
    const served = mockModel(JSON.stringify(review), { openrouter: { usage: { cost: 0.01 }, provider: "DigitalOcean" } });
    expect((await reviewDiff(input, { model: served })).provider).toBe("DigitalOcean");
    expect((await reviewDiff(input, { model: mockModel(JSON.stringify(review)) })).provider).toBeUndefined();
  });

  // A zero would read as a free review in the PR comment and the variant comparison; the comment shows n/a.
  it("reports the cost as unknown, not zero, when the provider sends no usage accounting", async () => {
    expect((await reviewDiff(input, { model: mockModel(JSON.stringify(review)) })).costUsd).toBeUndefined();
  });

  it("rejects a score that is not an integer from 1 to 10, naming the criterion", async () => {
    for (const score of [0, 11, 7.5]) {
      const outOfRange = { ...review, criteria: { ...review.criteria, complexity: { score, rationale: "x" } } };
      await expect(reviewDiff(input, { model: mockModel(JSON.stringify(outOfRange)) }), String(score)).rejects.toThrow(
        /complexity/,
      );
    }
  });

  it("rejects output that does not match the review schema", async () => {
    const maybe = JSON.stringify({ ...review, verdict: "maybe" });
    await expect(reviewDiff(input, { model: mockModel(maybe) })).rejects.toThrow();
  });
});
