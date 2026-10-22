# 10x-ai-review-lab

Piaskownica do pipeline'ów AI code review na GitHub Actions (10xDevs, moduł 5, ścieżka A odznaki 10xChampion).

Mały projekt TypeScript (`src/`) z testami Vitest (`tests/`) istnieje po to, żeby było co recenzować. Dwa workflowy recenzują te same pull requesty i są porównywane na tych samych PR-ach:

| Workflow | Recenzent | Etykiety | Sekret |
| --- | --- | --- | --- |
| `.github/workflows/claude-review.yml` | `anthropics/claude-code-action` (gotowiec), prompt z sześcioma kryteriami i wymuszonym schematem werdyktu | `claude-cr:passed` / `claude-cr:failed` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `.github/workflows/review.yml` | własny agent w `reviewer/` (Vercel AI SDK + OpenRouter) przez composite action `.github/actions/ai-reviewer` | `ai-cr:passed` / `ai-cr:failed` | `OPENROUTER_API_KEY` |

Oba czytają ten sam kontrakt werdyktu (`reviewer/schema/review-schema.json`): sześć kryteriów ocenianych 1–10 z uzasadnieniem, wiążący `verdict: pass | fail` i `summary` w Markdown. Etykieta `ai-cr:review` dodana do PR-a uruchamia oba workflowy ponownie.

## Komendy

```bash
npm install
npm test
npm run typecheck
npm run schema:emit   # po każdej zmianie reviewer/src/review-schema.ts; test dryfu pilnuje plików w reviewer/schema/
```

## Recenzent wariantu 2 (`reviewer/`)

```bash
git diff main | npm run review                                    # diff ze stdin
npm run review -- --file reviewer/fixtures/sample.diff            # albo z pliku; --model <id OpenRouter>, --title <tekst>
npm run review -- --file x.diff --fail-on-verdict                 # kod wyjścia 1 przy verdict: fail
npm run build                                                     # reviewer/dist/, którego używa composite action
```

Klucz `OPENROUTER_API_KEY` w `reviewer/.env` (gitignorowany) albo w środowisku; domyślny model to `z-ai/glm-5.3` (`REVIEW_MODEL` lub `--model` go podmienia). Na stdout trafia jeden JSON: sześć ocen, `verdict`, `summary` i `meta` (model, czas, koszt z OpenRouter, tokeny, wykluczone pliki); logi idą na stderr. Testy agenta (`npm test`) używają atrapy modelu z `ai/test` i nie wykonują żadnych zapytań HTTP.
