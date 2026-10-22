// Writes the files generated from src/review-schema.ts: the contract claude-review.yml loads from the base branch
// of a pull request, and the promptfoo prompt. Run `npm run schema:emit` after every change to that module;
// the drift tests fail until you do.
import { mkdirSync, writeFileSync } from "node:fs";

import { REVIEWER_PROMPT, renderEvalPrompt, renderSchemaFile } from "../src/review-schema.js";

const schemaDir = new URL("../schema/", import.meta.url);
const evalPromptsDir = new URL("../evals/prompts/", import.meta.url);
mkdirSync(schemaDir, { recursive: true });
mkdirSync(evalPromptsDir, { recursive: true });
writeFileSync(new URL("review-schema.json", schemaDir), renderSchemaFile());
writeFileSync(new URL("reviewer-prompt.md", schemaDir), `${REVIEWER_PROMPT}\n`);
writeFileSync(new URL("review.txt", evalPromptsDir), renderEvalPrompt());
console.log("wrote reviewer/schema/review-schema.json, reviewer/schema/reviewer-prompt.md, reviewer/evals/prompts/review.txt");
