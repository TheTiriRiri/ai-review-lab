// Variant 2 reviewer: one ToolLoopAgent call per pull request, with the shared review contract as its output.
// The agent gets no tools and never reads the repository; it sees only the framed title, body and diff.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  isStepCount,
  Output,
  ToolLoopAgent,
  type LanguageModel,
  type LanguageModelUsage,
  type ProviderMetadata,
} from "ai";

import { buildReviewPrompt, type ReviewInput } from "./prompts.js";
import { CRITERIA_KEYS, REVIEWER_PROMPT, ReviewResult } from "./review-schema.js";

/** The course default model (M5L2); REVIEW_MODEL or --model replaces it. */
export const DEFAULT_MODEL = "z-ai/glm-5.3";

export interface ReviewOutcome {
  result: ReviewResult;
  usage: LanguageModelUsage;
  costUsd: number;
  durationMs: number;
  model: string;
}

/** An OpenRouter model by id, e.g. "z-ai/glm-5.3" or "anthropic/claude-sonnet-5.5". */
export function openRouterModel(modelId: string, apiKey: string): LanguageModel {
  return createOpenRouter({ apiKey })(modelId);
}

export function createReviewer(model: LanguageModel) {
  return new ToolLoopAgent({
    model,
    instructions: REVIEWER_PROMPT,
    tools: {},
    output: Output.object({ schema: ReviewResult }),
    // A hard step limit: one review is one model call, so the loop can never run away on cost.
    stopWhen: isStepCount(2),
    temperature: 0,
    // OpenRouter reports the real cost of each step only when usage accounting is requested.
    providerOptions: { openrouter: { usage: { include: true } } },
  });
}

// The schema cannot carry minimum or maximum (Anthropic structured output rejects them), so the range is checked here.
function assertScores(result: ReviewResult): void {
  for (const key of CRITERIA_KEYS) {
    const { score } = result.criteria[key];
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      throw new Error(`criterion ${key} has score ${score}; expected an integer from 1 to 10`);
    }
  }
}

function stepCostUsd(metadata: ProviderMetadata | undefined): number {
  const usage = metadata?.openrouter?.usage;
  const cost = typeof usage === "object" && usage !== null && "cost" in usage ? usage.cost : undefined;
  return typeof cost === "number" ? cost : 0;
}

/** Reviews one pull request; rejects unless the model returns a review that matches the contract. */
export async function reviewDiff(input: ReviewInput, { model }: { model: LanguageModel }): Promise<ReviewOutcome> {
  const started = performance.now();
  const { output, totalUsage, steps } = await createReviewer(model).generate({ prompt: buildReviewPrompt(input) });
  const result = ReviewResult.parse(output);
  assertScores(result);
  return {
    result,
    usage: totalUsage,
    costUsd: steps.reduce((sum, step) => sum + stepCostUsd(step.providerMetadata), 0),
    durationMs: Math.round(performance.now() - started),
    model: typeof model === "string" ? model : model.modelId,
  };
}
