// Local entry: `git diff main | npm run review` or `npm run review -- --file <path>`, with optional
// --model <openrouter id>, --title <text> and --fail-on-verdict (exit 1 when the verdict is fail).
// Prints the same JSON as the CI entry; OPENROUTER_API_KEY comes from the environment or reviewer/.env.
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_MODEL, openRouterModel } from "./agent.js";
import { runReview } from "./run.js";

const log = (line: string): void => {
  process.stderr.write(`ai-reviewer: ${line}\n`);
};

try {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      model: { type: "string", default: process.env.REVIEW_MODEL || DEFAULT_MODEL },
      title: { type: "string", default: "Local change" },
      "fail-on-verdict": { type: "boolean", default: false },
    },
  });
  if (values.file === undefined && process.stdin.isTTY) {
    throw new Error("pipe a diff in (git diff main | npm run review) or pass --file <path>");
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("missing OPENROUTER_API_KEY: put it in reviewer/.env or the environment");
  }
  // npm runs workspace scripts inside reviewer/; INIT_CWD is where npm was called, so --file paths keep their meaning.
  const diffSource = values.file === undefined ? "stdin" : resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
  const report = await runReview({
    diffSource,
    title: values.title,
    model: openRouterModel(values.model, apiKey),
    log,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (values["fail-on-verdict"] && report.verdict === "fail") {
    process.exitCode = 1;
  }
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
