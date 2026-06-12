# Layer 3 Task 4 (P1) — Tool System — Status Report

**Last updated:** 2026-05-09  
**Scope:** `LAYER3_TASK4_PLAN_P1_TOOLS.md` implementation (registry, new tools, search flip, parallel execution in worker path, file_gen fixes).

## Delivered

| Area | Notes |
|------|--------|
| Tool registry | `src/tools/registry.ts` — `registerTool`, `getTool`, `getToolsForAgent`. |
| Executor | `src/tools/executor.ts` — whitelist enforcement, `runToolsBatch` with bounded parallelism (`MAX_PARALLEL_TOOLS`). |
| Tool barrel | `src/tools/index.ts` — side-effect imports register all tools before router reads specs. |
| Router streaming | `streamCompletion(..., options)` accepts `runTools`; default remains sequential. |
| Chat worker | Passes `runTools: (c) => runToolsBatch(...)`, sets `ctx.agentSlug` / `ctx.queryComplexity`. |
| Web search | Brave-first for standard priority; Tavily for high / research agent / complex queries; `summarise` opt-out via param. |
| New tools | `web_fetch`, `html_generate`, `chart_generate`, `image_analyse`, `stock_data`, `get_weather`. |
| file_gen | PDF via `pdfkit`, TXT/CSV paths, binary storage for xlsx/docx/pdf/txt/csv. |
| Agents | Research / chat / ui / analyst / architect / writer / document updated per plan (`deep_research` deferred to P4). |
| Flags | `FeatureFlags` extended; migration `036_feature_flags_new_tools.sql`. |
| Env | `OPENWEATHERMAP_API_KEY`, `MAX_PARALLEL_TOOLS` in `src/config/env.ts` and `.env.example`. |

## Dependencies added

`@mozilla/readability`, `jsdom`, `yahoo-finance2`, `pdfkit`, `@types/jsdom`, `@types/pdfkit`.

## Operational notes

- **R2 storage:** Binary artifacts require local driver until R2 artifact storage is implemented (P3).
- **Yahoo Finance:** Uses `yahoo-finance2` v3; subject to Yahoo rate limits / availability.
- **Classifier:** `needsFileGen` prompt/schema extended with `txt` and `csv`.

## Follow-ups (out of original P1 scope)

- `deep_research` agent + routing (Task 7 / P4).
- Optional Postman collection entries if chat/tool behaviour is exposed via admin/debug routes.
