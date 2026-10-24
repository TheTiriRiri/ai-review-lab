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
import { CRITERIA_KEYS, REVIEWER_PROMPT, ReviewResult, SCORE_RANGE } from "./review-schema.js";

/** The course default model (M5L2); REVIEW_MODEL or --model replaces it. */
export const DEFAULT_MODEL = "z-ai/glm-5.3";

/** OpenRouter request fields that pin a model to upstream providers and cap its reasoning (sent as written). */
export interface OpenRouterRouting {
  provider: { order: string[]; allow_fallbacks: false; require_parameters: true };
  reasoning: { max_tokens: number };
}

// OpenRouter serves a model through many upstream providers and picks one per request by price. For glm-5.3 the
// cheapest (fp4) reasoned for a few hundred tokens and reviewed shallowly, and another one reasoned until it hit the
// output cap on one fixture (docs/comparison.md). A listed model goes only to its providers, in order, with reasoning
// capped below the output; a model not listed is left to OpenRouter. eval.yml grades the same routing.
export const MODEL_ROUTING: Record<string, OpenRouterRouting> = {
  [DEFAULT_MODEL]: {
    provider: { order: ["digitalocean", "sail-research"], allow_fallbacks: false, require_parameters: true },
    reasoning: { max_tokens: 12_000 },
  },
};

export interface ReviewOutcome {
  result: ReviewResult;
  usage: LanguageModelUsage;
  /** Undefined when a step reports no cost: an unknown cost is not a free review. */
  costUsd: number | undefined;
  durationMs: number;
  model: string;
  /** The upstream provider OpenRouter routed the review to, when it says. */
  provider: string | undefined;
}

/** An OpenRouter model by id, e.g. "z-ai/glm-5.3" or "anthropic/claude-sonnet-5.5". */
export function openRouterModel(modelId: string, apiKey: string): LanguageModel {
  return createOpenRouter({ apiKey })(modelId);
}

export function createReviewer(model: LanguageModel) {
  const routing = MODEL_ROUTING[modelIdOf(model)];
  return new ToolLoopAgent({
    model,
    instructions: REVIEWER_PROMPT,
    tools: {},
    output: Output.object({ schema: ReviewResult }),
    // A hard step limit: one review is one model call, so the loop can never run away on cost.
    stopWhen: isStepCount(2),
    temperature: 0,
    // OpenRouter reports the real cost of each step only when usage accounting is requested.
    providerOptions: { openrouter: { usage: { include: true }, ...routing } },
  });
}

// The schema cannot carry minimum or maximum (Anthropic structured output rejects them), so the range is checked here.
function assertScores(result: ReviewResult): void {
  for (const key of CRITERIA_KEYS) {
    const { score } = result.criteria[key];
    if (!Number.isInteger(score) || score < SCORE_RANGE.min || score > SCORE_RANGE.max) {
      throw new Error(`criterion ${key} has score ${score}; expected an integer from ${SCORE_RANGE.min} to ${SCORE_RANGE.max}`);
    }
  }
}

function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

function upstreamProvider(steps: readonly { providerMetadata: ProviderMetadata | undefined }[]): string | undefined {
  const provider = steps.at(-1)?.providerMetadata?.openrouter?.provider;
  return typeof provider === "string" && provider !== "" ? provider : undefined;
}

function stepCostUsd(metadata: ProviderMetadata | undefined): number | undefined {
  const usage = metadata?.openrouter?.usage;
  const cost = typeof usage === "object" && usage !== null && "cost" in usage ? usage.cost : undefined;
  return typeof cost === "number" ? cost : undefined;
}

function totalCostUsd(steps: readonly { providerMetadata: ProviderMetadata | undefined }[]): number | undefined {
  let total = 0;
  for (const step of steps) {
    const cost = stepCostUsd(step.providerMetadata);
    if (cost === undefined) return undefined;
    total += cost;
  }
  return total;
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
    costUsd: totalCostUsd(steps),
    durationMs: Math.round(performance.now() - started),
    model: modelIdOf(model),
    provider: upstreamProvider(steps),
  };
}
