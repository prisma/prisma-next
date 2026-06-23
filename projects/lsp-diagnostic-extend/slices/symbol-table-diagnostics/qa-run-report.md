# Manual QA report — TML-2934 (symbol-table-diagnostics, AC-7) — 2026-06-22

> **Script:** `manual-qa.md` (stub at run time — see note below); checks derived directly from AC-7 in `spec.md`
> **Runner:** LLM QA session (Zed agent)
> **Environment:** Linux 7.0.11, Node v24.15.0, branch `lsp-diagnostic-extend` @ `d76a792023e3181455c29ea2c9b0a733e236eb4c`
> **Started / finished:** 2026-06-22T14:22Z / 2026-06-22T14:26Z
> **Verdict:** ✅ Pass

## Summary

AC-7 is proven. The **same shipped binary the playground spawns** — `node <cli>/dist/cli.js lsp --stdio` — pointed at a default-postgres PSL config, publishes parse **and** symbol-table diagnostics live. A duplicate top-level declaration produced `PSL_DUPLICATE_DECLARATION`; editing the buffer to a clean schema cleared the marker to `[]`; an over-qualified field type produced `PSL_INVALID_QUALIFIED_TYPE`. All three checks passed. No blockers. Two non-issue observations are recorded below (both expected behavior, neither a regression).

## Approach

The CodeMirror editor and the WebSocket bridge are untouched by this slice; only `@prisma-next/language-server` changed. So rather than drive a browser, the run exercises the **real subprocess directly as an LSP client** — exactly what `apps/lsp-playground/src/bridge.ts` does via `createServerProcess('PSL', 'node', [cliEntry, 'lsp', '--stdio'])` and `forward(...)`, minus the browser transport. A true browser test would have required adding Playwright (a new dependency); per the brief that was not done unilaterally, and it is unnecessary because the bridge + editor are out of scope for this slice and the subprocess is the actual surface under test.

What was real (not mocked) in this run:

- The shipped CLI binary (`packages/1-framework/3-tooling/cli/dist/cli.js`), built fresh from the slice's source.
- Full config resolution: `loadConfig` → `c12`/`jiti` transpiling the staged TypeScript `prisma-next.config.ts` and resolving its `@prisma-next/*` imports.
- `createControlStack(config)` producing the real `scalarTypes` + `pslBlockDescriptors`.
- `buildSymbolTable(...)` over the in-memory document buffer, merged with parse diagnostics, mapped, and pushed over `textDocument/publishDiagnostics`.

The staged config **mirrors `apps/lsp-playground/src/default-config.ts`** verbatim (the "without a config, assume default postgres" recipe). It was staged under `apps/lsp-playground/qa-ac7-tmp/` so its `@prisma-next/*` imports resolve through the playground's `node_modules` — the same resolution constraint the real playground satisfies by staging under `.playground/`. The client was a ~320-line throwaway `run-qa.mjs` implementing LSP `Content-Length` framing over the child's stdio (zero external deps; identical wire protocol to what the bridge forwards). Both the temp dir and the script were removed after the run.

## Exact commands

```bash
# 1. Build the changed package, then the binary the bridge spawns.
pnpm --filter @prisma-next/language-server build
pnpm --filter @prisma-next/cli build

# 2. Drive the real `prisma-next lsp --stdio` subprocess as an LSP client.
#    (throwaway harness, staged + removed under apps/lsp-playground/qa-ac7-tmp/)
node apps/lsp-playground/qa-ac7-tmp/run-qa.mjs   # exit 0 = all three checks passed

# 3. Supporting validation.
pnpm --filter @prisma-next/language-server test
cd packages/1-framework/3-tooling/language-server && pnpm typecheck
pnpm lint:deps
```

The harness performed, over one bounded LSP session against one spawned server:

1. `initialize` (`rootUri` = staged dir, `workspace.didChangeWatchedFiles.dynamicRegistration: true`) → `initialized`.
2. `textDocument/didOpen` with a duplicate-`model User` schema.
3. `textDocument/didChange` (version 2) replacing the buffer with a clean schema.
4. `textDocument/didChange` (version 3) replacing the buffer with an over-qualified field type (`user a.b.c`).

The schema document URI fed to `didOpen` and the absolute path written into `contract.source.inputs` were the same string, so `resolveSchemaInputs`' `pathToFileURL(input)` matched the opened URI.

## Checks — observed `publishDiagnostics`

### Check 1 — duplicate top-level declaration → `PSL_DUPLICATE_DECLARATION` ✅

Schema (`schema.psl`):

```prisma
model User {
  id Int @id
}

model User {
  id Int @id
}
```

Published payload (`uri` = the staged `schema.psl`):

```json
[
  {
    "code": "PSL_DUPLICATE_DECLARATION",
    "message": "Duplicate declaration of \"User\"",
    "severity": 1,
    "range": { "start": { "line": 4, "character": 6 }, "end": { "line": 4, "character": 10 } },
    "source": "prisma-next"
  }
]
```

The marker lands on the second `User` (line 4). **Pass.**

### Check 2 — edit to a clean schema clears the marker → `[]` ✅

`didChange` (version 2) replaced the buffer with:

```prisma
model User {
  id Int @id
}
```

Published payload:

```json
[]
```

**Pass** — the symbol-table marker is cleared live on edit.

### Check 3 (bonus) — over-qualified field type → `PSL_INVALID_QUALIFIED_TYPE` ✅

`didChange` (version 3) replaced the buffer with:

```prisma
model Profile {
  user a.b.c
}
```

Published payload (two diagnostics — parse tier then symbol-table tier):

```json
[
  {
    "code": "PSL_INVALID_QUALIFIED_NAME",
    "message": "Qualified name has too many segments",
    "severity": 1,
    "range": { "start": { "line": 1, "character": 10 }, "end": { "line": 1, "character": 11 } },
    "source": "prisma-next"
  },
  {
    "code": "PSL_INVALID_QUALIFIED_TYPE",
    "message": "Field \"Profile.user\" has an invalid qualified type \"a.b.c\"; use at most one namespace qualifier (e.g. \"ns.TypeName\")",
    "severity": 1,
    "range": { "start": { "line": 1, "character": 7 }, "end": { "line": 1, "character": 12 } },
    "source": "prisma-next"
  }
]
```

The required `PSL_INVALID_QUALIFIED_TYPE` is present. The leading `PSL_INVALID_QUALIFIED_NAME` is the parse-tier diagnostic for the same construct, and its position ahead of the symbol-table diagnostic confirms the spec's parse-then-symbol-table merge order on the live path. **Pass.**

## Per-scenario log

| # | Scenario                                              | Isolation                          | Result  | Findings |
| - | ----------------------------------------------------- | ---------------------------------- | ------- | -------- |
| 1 | Duplicate declaration → `PSL_DUPLICATE_DECLARATION`   | staged dir + real `lsp --stdio`    | ✅ pass | —        |
| 2 | Edit to clean schema → cleared `[]`                   | same session (didChange v2)        | ✅ pass | —        |
| 3 | Over-qualified field type → `PSL_INVALID_QUALIFIED_TYPE` | same session (didChange v3)     | ✅ pass | F-2      |
| — | Supporting: `language-server` unit tests              | vitest                             | ✅ 56 passed | — |
| — | Supporting: `language-server` typecheck               | `tsc --noEmit`                     | ✅ pass | —        |
| — | Supporting: `pnpm lint:deps` (backs AC-5)             | depcruise + framework/target lint  | ✅ pass | —        |

## Coverage outcome

| AC ID | Scenario(s) | Result  | Notes                                                                                          |
| ----- | ----------- | ------- | ---------------------------------------------------------------------------------------------- |
| AC-7  | 1, 2, 3     | ✅ pass | Real shipped `prisma-next lsp --stdio` + default-postgres config publishes parse + symbol-table diagnostics live; duplicate flagged, fix cleared, over-qualified flagged. |
| AC-5  | lint:deps   | ✅ pass | `lint:deps` clean; "No `@prisma-next/target-*` references found inside `packages/1-framework`" — corroborates "no target dependency" through the same binary path. |

(AC-1…AC-6 are primarily CI/unit-test scope and were not the charter of this run, but the 56-test suite they are asserted by passed — see supporting log.)

## Findings

### F-1 — 📝 Follow-up (informational) — two identical publishes on `didOpen`

**Scenario:** 1 — duplicate declaration.
**Observed:** the duplicate schema's `PSL_DUPLICATE_DECLARATION` payload was published **twice**, identically, in the open phase.
**Explanation:** `vscode-languageserver`'s `TextDocuments` fires both `onDidOpen` and `onDidChangeContent` on initial open, and `server.ts` registers `publishSafely` on each. The two publishes are byte-identical and idempotent — the editor renders the same single marker. Not a regression and not user-visible. Recorded only so a future reader doesn't mistake it for a duplicate-diagnostic bug.

### F-2 — 📝 Follow-up (informational) — over-qualified type surfaces two codes

**Scenario:** 3 — over-qualified field type.
**Observed:** `user a.b.c` produced `PSL_INVALID_QUALIFIED_NAME` (parse tier) **and** `PSL_INVALID_QUALIFIED_TYPE` (symbol-table tier).
**Explanation:** expected. AC-1/AC-7 require the symbol-table code, which is present; the parse-tier code is the existing tier's diagnostic for the same malformed construct, and its ordering ahead of the symbol-table code matches the spec's documented merge order. No action needed.

## Disposition map

| Finding | Severity              | Proposed disposition | Evidence / next step                                                                 |
| ------- | --------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| F-1     | 📝 Follow-up (info)   | ❌ accepted-as-is    | Idempotent double publish is a stock `TextDocuments` behavior; no user-visible effect |
| F-2     | 📝 Follow-up (info)   | ❌ accepted-as-is    | Two-tier output is the intended merged-pipeline behavior; required code is present    |

Neither finding is 🛑 Blocker / ⚠️ High and neither is 🔧 fix-in-PR, so per the verdict policy the run is ✅ Pass.

## Suggested follow-ups

- The slice's `manual-qa.md` is currently a stub (title + an unterminated `**`). Consider fleshing it into a real `drive-qa-plan` script that encodes these three checks (plus the fault-tolerance edge cases in `spec.md`), so future runs are repeatable from a written script rather than re-derived from the ACs. Non-blocking for AC-7.
- If a browser-level smoke of the playground is ever wanted as belt-and-suspenders, that would need Playwright added as a dev dependency — out of scope here and not required to satisfy AC-7.

## Cleanup

- Throwaway harness + staged config/schema (`apps/lsp-playground/qa-ac7-tmp/`) removed.
- `git status` after the run shows only the slice's tracked implementation changes plus this report; `apps/lsp-playground/src/client/runtime.ts` is **not** modified.
- No language server left running (the spawned subprocess is `SIGKILL`ed at the end of the bounded session).
