// CI entry of the composite action (.github/actions/ai-reviewer). The pull request comes from the environment;
// one JSON object ({...review, meta}) goes to stdout and every log line to stderr, so stdout can go to a file.
import { DEFAULT_MODEL, openRouterModel } from "./agent.js";
import { runReview } from "./run.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing environment variable ${name}`);
  }
  return value;
}

const log = (line: string): void => {
  process.stderr.write(`ai-reviewer: ${line}\n`);
};

try {
  const diffSource = requireEnv("DIFF_FILE");
  const model = openRouterModel(process.env.REVIEW_MODEL || DEFAULT_MODEL, requireEnv("OPENROUTER_API_KEY"));
  const report = await runReview({ diffSource, title: process.env.PR_TITLE ?? "", body: process.env.PR_BODY, model, log });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  const cost = report.meta.costUsd === undefined ? "cost n/a" : `$${report.meta.costUsd}`;
  log(`verdict ${report.verdict} from ${report.meta.model} in ${report.meta.durationMs} ms, ${cost}`);
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
