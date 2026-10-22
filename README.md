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
```
