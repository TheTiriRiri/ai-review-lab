// The pipeline both entry points share (cli.ts locally, review.ts in CI): read and trim the diff,
// review it, and attach the run metadata the PR comment footer and the variant comparison read.
import type { LanguageModel } from "ai";

import { reviewDiff } from "./agent.js";
import { readDiff, trimDiff } from "./diff.js";
import type { ReviewResult } from "./review-schema.js";

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
  meta: {
    model: string;
    durationMs: number;
    costUsd: number;
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
  return {
    ...outcome.result,
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
