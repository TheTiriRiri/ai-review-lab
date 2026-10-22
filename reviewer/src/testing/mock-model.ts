// Test doubles shared by the reviewer tests: a canned review and a model that returns it without any HTTP.
// Excluded from the build (tsconfig.build.json).
import { MockLanguageModelV4 } from "ai/test";

import type { ReviewResult } from "../review-schema.js";

export const passingReview: ReviewResult = {
  criteria: {
    implementationCorrectness: { score: 8, rationale: "src/date-range.ts:31 steps backward for a negative count." },
    idiomaticity: { score: 8, rationale: "Keeps the loop style of the module." },
    complexity: { score: 9, rationale: "One step variable instead of a second loop." },
    testRiskCoverage: { score: 7, rationale: "Three tests cover the backward direction." },
    documentation: { score: 8, rationale: "The JSDoc explains weekend starts." },
    securitySafety: { score: 10, rationale: "No input handling changes." },
  },
  verdict: "pass",
  summary: "**PASS.** Negative counts step backward over weekends.",
};

/** A model that answers every call with `text`, 1200 input and 300 output tokens, and optional OpenRouter metadata. */
export function mockModel(text: string, providerMetadata?: { openrouter: { usage: { cost: number } } }) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1200, noCache: 1200, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 300, text: 300, reasoning: 0 },
      },
      warnings: [],
      ...(providerMetadata ? { providerMetadata } : {}),
    },
  });
}
