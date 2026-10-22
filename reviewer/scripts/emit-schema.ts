// Writes the contract files that claude-review.yml loads from the base branch of a pull request.
// Run `npm run schema:emit` after every change to src/review-schema.ts; the drift tests fail until you do.
import { mkdirSync, writeFileSync } from "node:fs";

import { REVIEWER_PROMPT, renderSchemaFile } from "../src/review-schema.js";

const dir = new URL("../schema/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("review-schema.json", dir), renderSchemaFile());
writeFileSync(new URL("reviewer-prompt.md", dir), `${REVIEWER_PROMPT}\n`);
console.log("wrote reviewer/schema/review-schema.json and reviewer/schema/reviewer-prompt.md");
