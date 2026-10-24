# 10x-ai-review-lab

Piaskownica do pipeline'ów AI code review na GitHub Actions (10xDevs, moduł 5, ścieżka A odznaki 10xChampion).

Mały projekt TypeScript (`src/`) z testami Vitest (`tests/`) istnieje po to, żeby było co recenzować. Dwa workflowy recenzują te same pull requesty i są porównywane na tych samych PR-ach:

| Workflow | Recenzent | Etykiety | Sekret |
| --- | --- | --- | --- |
| `.github/workflows/claude-review.yml` | `anthropics/claude-code-action` (gotowiec), prompt z sześcioma kryteriami i wymuszonym schematem werdyktu | `claude-cr:passed` / `claude-cr:failed` | `CLAUDE_CODE_OAUTH_TOKEN` |
| `.github/workflows/review.yml` | własny agent w `reviewer/` (Vercel AI SDK + OpenRouter) przez composite action `.github/actions/ai-reviewer` | `ai-cr:passed` / `ai-cr:failed` | `OPENROUTER_API_KEY` |

Oba czytają ten sam kontrakt werdyktu (`reviewer/schema/review-schema.json`): sześć kryteriów ocenianych 1–10 z uzasadnieniem, `verdict: pass | fail` i `summary` w Markdown. Wiążący werdykt, który czyta bramka, wynika z ocen według reguły kontraktu: w wariancie 1 jest to `reviewer/schema/verdict.jq` z gałęzi bazowej, w wariancie 2 `verdictFor`. Werdykt samego modelu zostaje w `modelVerdict`, a komentarz zaznacza, gdy reguła go zmieniła. Tekst modelu w komentarzu jest nieufny, więc `.github/scripts/render-comment.mjs` wstawia niewidoczny znak zero-width space (U+200B) po `<` przed tagiem, przed linią nagłówka i po `@` wzmianki; kod inline i bloki kodu zagnieżdżone w liście lub cytacie skopiowane z komentarza zawierają ten znak. Etykieta `ai-cr:review` dodana do PR-a uruchamia oba workflowy ponownie, ale na commicie scalającym, który GitHub policzył przy ostatniej zmianie PR-a; żeby recenzja objęła nowszy main, trzeba wypchnąć commit na gałąź PR-a.

Kryteria i ich kotwice (co znaczy ocena 1, a co 10) są w `RUBRIC` w `reviewer/src/review-schema.ts`, ustalone 2026-10-24 na bazie kotwic z `m5l3-requirements.md`. Trzy różnice są celowe:
- **Poprawność** ocenia zgodność z tym, co zmiana deklaruje: z tytułem i opisem, gdy są, a inaczej z kodem, komentarzami i testami. Opis PR-a dostaje tylko wariant 2; wariant 1 ma tytuł, diff i repo, a eval sam diff. Z tego samego powodu opis PR-a nie liczy się jako dokumentacja.
- **Bezpieczeństwo** nie ma kotwicy o zależnościach ze znanymi podatnościami, bo żaden recenzent nie ma źródła CVE (wariant 1 nie ma WebFetch ani WebSearch, eval nie ma narzędzi). Jest za to kotwica o zależnościach, których zmiana nie potrzebuje.
- **Dokumentacja** zamiast nieaktualnego README ocenia zmianę publicznego zachowania bez zmiany w dokumentacji, bo to widać w diffie.

Próg werdyktu został bez zmian. Dodatkowy próg testRiskCoverage ≤ 4 nie zmieniłby żadnego werdyktu: na PR #3 każdy bieg i tak daje fail, a na PR #1 testRiskCoverage wynosi 7–8. Dodałby za to niestabilność przy ocenach na granicy.

## Komendy

```bash
npm install
npm test
npm run typecheck
npm run schema:emit   # po każdej zmianie reviewer/src/review-schema.ts; test dryfu pilnuje plików w reviewer/schema/ i reviewer/evals/prompts/
```

## Recenzent wariantu 2 (`reviewer/`)

```bash
git diff main | npm run review                                    # diff ze stdin
npm run review -- --file reviewer/fixtures/sample.diff            # albo z pliku; --model <id OpenRouter>, --title <tekst>
npm run review -- --file x.diff --fail-on-verdict                 # kod wyjścia 1 przy verdict: fail
npm run build                                                     # reviewer/dist/, którego używa composite action
```

Klucz `OPENROUTER_API_KEY` w `reviewer/.env` (gitignorowany) albo w środowisku; domyślny model to `z-ai/glm-5.3` (`REVIEW_MODEL` lub `--model` go podmienia). Na stdout trafia jeden JSON: sześć ocen, `verdict` (z reguły), `modelVerdict`, `summary` i `meta` (model, czas, koszt z OpenRouter, tokeny, wykluczone pliki); logi idą na stderr. Testy agenta (`npm test`) używają atrapy modelu z `ai/test` i nie wykonują żadnych zapytań HTTP.

OpenRouter obsługuje jeden model przez wielu dostawców i wybiera ich według ceny, a dla glm-5.3 jakość recenzji zależała od tego wyboru. Dlatego `MODEL_ROUTING` w `reviewer/src/agent.ts` przypina glm-5.3 do DigitalOcean, zapasowo Sail Research. Reasoning nie ma limitu, bo z `reasoning.max_tokens` glm-5.3 myślał krócej niż 200 tokenów i recenzował płytko. Gdy obaj są niedostępni, recenzja kończy się błędem zamiast trafić do innego dostawcy. `meta.provider` podaje, kto recenzował. Model spoza mapy idzie przez domyślny routing OpenRouter. Eval używa tej samej konfiguracji, a test pilnuje, żeby się zgadzała.

## Evale promptfoo (`reviewer/evals/`)

```bash
npm run eval   # prompt recenzenta na trzech modelach OpenRouter i czterech fixturach; macierz w terminalu, wynik w reviewer/evals/out/results.json
```

Prompt (`reviewer/evals/prompts/review.txt`) generuje `schema:emit` z tego samego źródła co kontrakt CI. Klucz jak wyżej, z `reviewer/.env`; promptfoo czyta ten plik sam. Fixtury w `reviewer/evals/fixtures/` nie mogą zawierać `{{`, `{%` ani `{#`, bo promptfoo renderuje zmienne jako szablony Nunjucks; pilnuje tego test. Wyników nie oglądamy przez `promptfoo view`, bo uruchamia lokalny serwer WWW.

Ten sam eval jest bramką regresji w CI. `.github/workflows/eval.yml` uruchamia go na PR-ach, które zmieniają `reviewer/src/review-schema.ts`, `reviewer/schema/` albo `reviewer/evals/`, oraz ręcznie (`workflow_dispatch`). Bramka ocenia tylko model wariantu 2 (`z-ai/glm-5.3`) i wymaga zaliczenia wszystkich przypadków; dwa pozostałe modele zostają do ręcznego porównania. Bieg trwa kilka minut i kosztuje ok. $0.15–0.40, a pojedynczą pomyłkę gradera usuwa ponowny bieg.
