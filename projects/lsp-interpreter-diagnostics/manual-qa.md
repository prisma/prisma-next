# Manual QA — lsp-interpreter-diagnostics

**Audiences** (per `drive/calibration/patterns.md § Consumer audiences`): end users
editing PSL schemas in an editor (via `apps/lsp-playground` or `prisma-next lsp`);
extension authors are N/A — this project adds no extension-facing surface (the
capability is provider-internal; extension packs are consumed unchanged through
`ContractSourceContext`).

**Pre-QA gate**: `pnpm typecheck && pnpm test:packages && pnpm fixtures:check` green.

**Substrate**: a scratch project with the lsp-playground default-postgres config
(`prismaContract` from `@prisma-next/sql-contract-psl`) and the workspace-built
language server. Two execution modes: (A) headless — drive the server binary over
LSP stdio with a scripted client (protocol-level proof, agent-runnable); (B) editor —
`apps/lsp-playground` in a browser (human-runnable; visual confirmation).

## Scenario 1 — interpreter diagnostic appears live and clears (AC1)

1. Open a clean schema (`User`/`Post` with a valid relation) → expect: no diagnostics.
2. Edit: add `tags Unknown[]` to `User` (syntactically valid; symbol table passes;
   interpreter rejects) → expect: one diagnostic on the schema document, positioned
   on the offending span (not at 0,0), code from the interpreter
   (`PSL_UNSUPPORTED_FIELD_TYPE` family), WITHOUT restarting the server.
3. Remove the line → expect: diagnostic gone on the next pull/publish.
4. Repeat with an unresolvable relation (`ghost Ghost @relation(...)`, no `Ghost`
   model) → expect: interpreter diagnostic at the relation's span.

## Scenario 2 — parse + interpreter diagnostics coexist, no double-reporting

1. Introduce BOTH a parse error (unclosed brace on one model) and the `Unknown[]`
   field on another → expect: parse diagnostic AND interpreter diagnostic in one
   response; no duplicated parse findings (the LSP owns parse/symbol-table; the
   interpreter contributes only its own stage).

## Scenario 3 — config break/fix cycle with open document (AC9 + retention)

1. With the schema open and healthy: break the config (e.g. `throw new Error('boom')`
   in `prisma-next.config.ts`) and trigger the watched-file change → expect: a
   diagnostic on the **config-file URI** at (0,0)–(0,1), code
   `PRISMA_NEXT_CONFIG_LOAD_FAILED`, message containing the thrown text — AND the
   schema document's diagnostics (incl. interpreter findings) still served from the
   last-good project (no wipe).
2. Fix the config, trigger the change → expect: config diagnostic cleared (empty
   publish), schema now served by the fresh project.

## Scenario 4 — config break/fix with NO open documents (the healed residual)

1. Break the config with no schema document open; open a schema doc → first load
   fails → expect: config diagnostic; document unmanaged (no schema diagnostics).
2. Close the schema doc; fix the config; trigger the change → expect: the marker
   clears WITHOUT any document reopening (the `failed` entry keeps the config on the
   refresh radar).

## Scenario 5 — graceful degradation

1. Point the config at a `typescript` contract source (or a provider without
   `interpret`) → expect: parse + symbol-table diagnostics only; no interpreter
   findings; no errors, no warnings; behavior identical to pre-project.

**Pass bar**: all expectations hold; any deviation is a 🛑 Blocker finding with the
transcript/artefacts under `manual-qa-reports/artefacts/`.
