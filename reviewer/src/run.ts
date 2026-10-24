// The pipeline both entry points share (cli.ts locally, review.ts in CI): read and trim the diff,
// review it, and attach the run metadata the PR comment footer and the variant comparison read.
import type { LanguageModel } from "ai";

import { reviewDiff } from "./agent.js";
import { readDiff, trimDiff } from "./diff.js";
import { type ReviewResult, verdictFor } from "./review-schema.js";

/** The same cap as the workflows; a lockfile never carries a decision worth reviewing. */
export const MAX_DIFF_BYTES = 200_000;
export const EXCLUDE_GLOBS = ["**/package-lock.json"];

export interface RunOptions {
  diffSource: string;
  title: string;
  body?: string | undefined;
  model: LanguageModel;
  log?: (line: string) => void;
}

export interface ReviewReport extends ReviewResult {
  /** The verdict the model returned; `verdict` is the one VERDICT_RULE gives its scores, and the gate reads that. */
  modelVerdict: ReviewResult["verdict"];
  meta: {
    model: string;
    durationMs: number;
    costUsd: number | undefined;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    truncated: boolean;
    excludedFiles: string[];
  };
}

export async function runReview({ diffSource, title, body, model, log = () => {} }: RunOptions): Promise<ReviewReport> {
  const trimmed = trimDiff(await readDiff(diffSource), { maxBytes: MAX_DIFF_BYTES, excludeGlobs: EXCLUDE_GLOBS });
  if (trimmed.diff.trim() === "") {
    throw new Error(`nothing to review in ${diffSource} once ${EXCLUDE_GLOBS.join(", ")} is excluded`);
  }
  log(`reviewing ${Buffer.byteLength(trimmed.diff)} bytes of diff${trimmed.truncated ? " (truncated)" : ""}`);

  const outcome = await reviewDiff({ title, body, diff: trimmed.diff }, { model });
  const verdict = verdictFor(outcome.result.criteria);
  if (verdict !== outcome.result.verdict) {
    log(`model verdict ${outcome.result.verdict} contradicts its scores; the rule gives ${verdict}`);
  }
  return {
    ...outcome.result,
    verdict,
    modelVerdict: outcome.result.verdict,
    meta: {
      model: outcome.model,
      durationMs: outcome.durationMs,
      costUsd: outcome.costUsd,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      truncated: trimmed.truncated,
      excludedFiles: trimmed.excludedFiles,
    },
  };
}
