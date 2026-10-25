# ai-review-lab

A sandbox for AI code review pipelines on GitHub Actions (10xDevs, module 5, path A of the 10xChampion badge).

A small TypeScript project (`src/`) with Vitest tests (`tests/`) exists so there is something to review. Two workflows review the same pull requests and are compared on the same PRs:

| Workflow | Reviewer | Labels | Secret |
| --- | --- | --- | --- |
| `.github/workflows/claude-review.yml` | `anthropics/claude-code-action` (off the shelf), a prompt with six criteria and an enforced verdict schema | `claude-cr:passed` / `claude-cr:failed` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `.github/workflows/review.yml` | a custom agent in `reviewer/` (Vercel AI SDK + OpenRouter) through the composite action `.github/actions/ai-reviewer` | `ai-cr:passed` / `ai-cr:failed` | `OPENROUTER_API_KEY` |

Both read the same verdict contract (`reviewer/schema/review-schema.json`): six criteria scored 1–10 with a rationale, `verdict: pass | fail` and a Markdown `summary`. The binding verdict the gate reads follows from the scores by the contract's rule: in variant 1 that is `reviewer/schema/verdict.jq` from the base branch, in variant 2 `verdictFor`. The model's own verdict stays in `modelVerdict`, and the comment notes when the rule changed it. Model text in the comment is untrusted, so `.github/scripts/render-comment.mjs` inserts an invisible zero-width space (U+200B) after the `<` of a tag, before a heading line and after the `@` of a mention; inline code, and code blocks nested in a list or a quote, copied from the comment contain that character. The `ai-cr:review` label added to a PR runs both workflows again, but on the merge commit GitHub computed at the PR's last change; for the review to cover a newer main, push a commit to the PR branch.

Criteria and their anchors (what a score of 1 means and what a 10 means) are in `RUBRIC` in `reviewer/src/review-schema.ts`, agreed on 2026-10-24, starting from the anchors the course material for this module proposes. Three differences are deliberate:
- **Correctness** scores agreement with what the change claims: with the title and description when there are any, otherwise with the code, comments and tests. Only variant 2 gets the PR description; variant 1 has the title, the diff and the repo, and the eval the diff alone. For the same reason the PR description does not count as documentation.
- **Security** has no anchor about dependencies with known vulnerabilities, because no reviewer has a CVE source (variant 1 has no WebFetch or WebSearch, the eval has no tools). It has an anchor about dependencies the change does not need instead.
- **Documentation** scores a change in public behaviour with no change to the docs instead of an outdated README, because that shows in the diff.

The verdict threshold stayed unchanged. An extra threshold of testRiskCoverage ≤ 4 would not change any verdict: on PR #3 every run fails anyway, and on PR #1 testRiskCoverage is 7–8. It would, however, add instability for scores at the boundary.

## Commands

```bash
npm install
npm test
npm run typecheck
npm run schema:emit   # after every change to reviewer/src/review-schema.ts; a drift test guards the files in reviewer/schema/ and reviewer/evals/prompts/
```

## Variant 2 reviewer (`reviewer/`)

```bash
git diff main | npm run review                                    # diff from stdin
npm run review -- --file reviewer/fixtures/sample.diff            # or from a file; --model <OpenRouter id>, --title <text>
npm run review -- --file x.diff --fail-on-verdict                 # exit code 1 on verdict: fail
npm run build                                                     # reviewer/dist/, which the composite action uses
```

The `OPENROUTER_API_KEY` key goes in `reviewer/.env` (gitignored) or in the environment; the default model is `z-ai/glm-5.3` (`REVIEW_MODEL` or `--model` overrides it). Stdout gets one JSON object: six scores, `verdict` (from the rule), `modelVerdict`, `summary` and `meta` (model, duration, cost from OpenRouter, tokens, excluded files); logs go to stderr. The agent tests (`npm test`) use a mock model from `ai/test` and make no HTTP requests.

OpenRouter serves one model through many providers and picks them by price, and for glm-5.3 the review quality depended on that choice. That is why `MODEL_ROUTING` in `reviewer/src/agent.ts` pins glm-5.3 to DigitalOcean, with Sail Research as the fallback. Reasoning has no cap, because with `reasoning.max_tokens` glm-5.3 thought for under 200 tokens and reviewed shallowly. When both providers are unavailable, the review fails instead of going to another provider. `meta.provider` says who served the review. A model outside the map goes through OpenRouter's default routing. The eval uses the same configuration, and a test checks that the two match.

## promptfoo evals (`reviewer/evals/`)

```bash
npm run eval   # the reviewer prompt on three OpenRouter models and four fixtures; matrix in the terminal, result in reviewer/evals/out/results.json
```

The prompt (`reviewer/evals/prompts/review.txt`) is generated by `schema:emit` from the same source as the CI contract. The key is read as above, from `reviewer/.env`; promptfoo reads that file itself. Fixtures in `reviewer/evals/fixtures/` must not contain `{{`, `{%` or `{#`, because promptfoo renders variables as Nunjucks templates; a test guards this. Results are not viewed with `promptfoo view`, because it starts a local web server.

The same eval is a regression gate in CI. `.github/workflows/eval.yml` runs it on PRs that change `reviewer/src/review-schema.ts`, `reviewer/schema/` or `reviewer/evals/`, and manually (`workflow_dispatch`). The gate scores only the variant 2 model (`z-ai/glm-5.3`) and requires every case to pass; the other two models remain for manual comparison. The gated model gets the contract as a strict `json_schema` `response_format`, as variant 2 sends it, so the provider constrains the review to the contract; the other two get the prompt alone. A run takes a few minutes and costs about $0.15–0.40. A single grader mistake is cleared by running it again, and a failed run keeps `reviewer/evals/out/results.json`, with the raw model outputs, as the artifact `promptfoo-results`.
