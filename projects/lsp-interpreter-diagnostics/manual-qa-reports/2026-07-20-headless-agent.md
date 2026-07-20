# Manual QA run — 2026-07-20, headless (mode A), agent-executed

**Script:** [`../manual-qa.md`](../manual-qa.md), scenarios 1–5, mode A (headless LSP stdio).
**Mode B (human editor pass): NOT RUN** — this report covers the protocol-level proof only.

## Environment

- Commit: `96a97840a7bffcc19636046534c821c27a9d589c` (branch `tml-2984-close-out`, all six build slices merged)
- Node: v24.16.0
- Server under test: the **built** binary — `node packages/1-framework/3-tooling/cli/dist/cli.mjs lsp --stdio` (real language server, real `prismaContract` sql provider; zero test doubles)
- Substrate: scratch project under `apps/lsp-playground/.playground/qa-scratch/` (playground default-postgres config recipe; real `schema.prisma` on disk); throwaway stdio client script (not committed); pull-diagnostics-capable client with dynamic watched-files registration
- Pre-QA gate: `pnpm typecheck && pnpm fixtures:check` green at run time; `pnpm test:packages` green modulo the documented NixOS mongodb-memory-server families (see project close-out notes)

## Results

| # | Step | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | Clean schema | no diagnostics | `[]` | ✅ |
| 1 | `tags Unknown[]` added live | one interpreter diagnostic at its span, no restart | `PSL_UNSUPPORTED_FIELD_TYPE` at (3,2)–(3,16) | ✅ |
| 1 | Line removed | diagnostic clears on next pull | `[]` | ✅ |
| 1 | Unresolvable relation | interpreter diagnostic at relation span | `PSL_UNSUPPORTED_FIELD_TYPE` + `PSL_INVALID_RELATION_TARGET` at (3,2)–(3,60) | ✅ |
| 2 | Parse error + `Unknown[]` together | both stages in one response, no double-reporting | `PSL_INVALID_MODEL_MEMBER`, `PSL_DUPLICATE_DECLARATION` + two `PSL_UNSUPPORTED_FIELD_TYPE` at **distinct spans/messages** (`Broken.model`, `Broken.tags` — both real findings on the recovered CST); zero exact duplicates | ✅ |
| 3 | Config broken (throw) + watched change | diagnostic on config URI at (0,0)–(0,1), code `PRISMA_NEXT_CONFIG_LOAD_FAILED`, **message containing the thrown text** | URI ✅ range ✅ code ✅ severity ✅ — **message = `"Unexpected error"`, thrown text absent** | 🛑 **Blocker** (below) |
| 3 | Schema pulled while config broken | last-good project serves; interpreter finding retained | byte-identical diagnostics to pre-break pull | ✅ |
| 3 | Config fixed + watched change | marker cleared (empty publish); fresh project serves | empty publish on config URI observed; schema findings intact | ✅ |
| 4 | Broken config, first load via open+pull | config marker published; document unmanaged (pull `[]`) | marker `PRISMA_NEXT_CONFIG_LOAD_FAILED`; pull `[]` | ✅ |
| 4 | Doc closed, config fixed, watched change | marker clears with **no document open** | empty publish on config URI observed | ✅ |
| 5 | Capability-less psl provider (no `interpret`) | parse/symbol-table only; zero interpreter findings; no errors | `PSL_INVALID_MODEL_MEMBER`, `PSL_DUPLICATE_DECLARATION`; zero `PSL_UNSUPPORTED_FIELD_TYPE` | ✅ |

**10/11 checks pass. One Blocker.**

## 🛑 Blocker — config-failure diagnostic loses the thrown error text

**Expected** (script scenario 3; project AC9 wording "message carrying the error text"): the config-URI diagnostic's message contains the config's thrown text (`qa-broken-config`).

**Observed**: `message: "Unexpected error"` — generic, actionless. The thrown text never reaches the editor.

**Root cause** (diagnosed, not fixed — out of this dispatch's scope): `loadConfig` wraps raw config throws in `CliStructuredError('4999', 'Unexpected error', { why: 'Failed to load config: <text>' })` (`config-loader/src/load.ts:135-137`). The server's `publishConfigFailure` reads `error.message` — for wrapped errors that is the generic envelope title; the useful text sits in the structured error's `why` field, which the server ignores.

**Why the unit suite missed it**: the server tests mock `resolveConfigInputs` and reject with plain `Error('config exploded')`, whose `.message` *is* the thrown text. The wrapping happens one layer below the mock seam — precisely the un-doubled link this headless run exists to exercise.

**Suggested fix shape** (for the follow-up dispatch): `publishConfigFailure` should prefer the structured error's `why` (or compose `message` + `why`) when the error is a `CliStructuredError`; a unit test should reject through a real `CliStructuredError` to pin it.

## Notes

- Scenario 2's "no double-reporting" bar is met in the meaningful sense: the two `PSL_UNSUPPORTED_FIELD_TYPE` entries are distinct findings (different fields, different spans, different messages) produced by interpreting the recovered CST — not a duplicated report of one finding.
- Scenario 4 required pull-client fidelity in the harness: project resolution triggers on the pull request, not on didOpen — matching the server's documented pull-client behavior.
