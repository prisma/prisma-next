# Manual QA run — 2026-07-03 — agent (headless)

**Script:** `projects/lsp-document-state/manual-qa.md`
**Scope:** Part A only (headless bridge smoke). **Part B was not run** — it requires a browser to certify Monaco marker rendering and remains open for a browser-equipped runner.

## Environment

- Repo: `/Users/sevinf/projects/worktrees/prisma-next/lsp-pull-refactor/prisma-next`, branch `lsp-document-state`
- macOS, shell Node (per repo policy), `pnpm`
- Closure built via `pnpm --filter @prisma-next/lsp-playground... run --if-present build` (green)
- Playground started with `pnpm --filter @prisma-next/lsp-playground start`; scratch schema staged at `apps/lsp-playground/.playground/scratch.psl` (empty), runtime config served at `/__psl_playground_runtime.json` with `wsPath: "/psl"`
- Headless client: throwaway script `wip/qa/headless-lsp-smoke.mjs` (gitignored) speaking raw JSON-RPC 2.0 as plain JSON text frames over `ws://localhost:5295/psl` (the bridge uses `vscode-ws-jsonrpc` `WebSocketMessageReader/Writer` — no Content-Length framing; verified against `apps/lsp-playground/src/bridge.ts`)
- Client `initialize` capabilities advertised: `textDocument.diagnostic { dynamicRegistration: false }`, `textDocument.publishDiagnostics {}`, `workspace.diagnostics { refreshSupport: true }`
- Session flow: `initialize` → `initialized` → `didOpen` (languageId `prisma`, version 1, broken PSL `model M {\n`) → `textDocument/diagnostic` → `didChange` (version 2, valid schema `model User { id Int @id; name String }`) → `textDocument/diagnostic` → `textDocument/semanticTokens/full` → `textDocument/foldingRange` → 3 s grace window listening for push diagnostics → `shutdown`/`exit`

## Part A results

### ☑ A1 — `initialize` advertises `diagnosticProvider` (interFileDependencies: false, workspaceDiagnostics: false)

**PASS.** From the `initialize` result:

```json
"diagnosticProvider": {
  "interFileDependencies": false,
  "workspaceDiagnostics": false
}
```

(Also advertised: `textDocumentSync: 2`, `foldingRangeProvider`, `semanticTokensProvider` with full+range, `documentFormattingProvider`, completion.)

### ☑ A2 — pull diagnostic on broken buffer returns a full report with the parse error and sane ranges

**PASS.** With the open buffer `model M {\n` (version 1), `textDocument/diagnostic` returned:

```json
{
  "kind": "full",
  "items": [
    {
      "range": { "start": { "line": 0, "character": 8 }, "end": { "line": 0, "character": 9 } },
      "message": "Unterminated block declaration",
      "code": "PSL_UNTERMINATED_BLOCK",
      "severity": 1,
      "source": "prisma-next"
    }
  ]
}
```

Range 0:8–0:9 covers the unclosed `{` — sane.

### ☑ A3 — no `textDocument/publishDiagnostics` arrives for this pull-capable client

**PASS.** A listener recorded every incoming notification for the entire session (didOpen through the post-request 3-second grace window). Zero `textDocument/publishDiagnostics` notifications were received:

```json
"publishDiagnosticsNotifications": []
```

### ☑ A4 — post-`didChange` pull report reflects the fixed buffer

**PASS.** Immediately after `didChange` (version 2) replacing the buffer with a valid schema, `textDocument/diagnostic` returned an empty full report — the lazy path served the synced document:

```json
{ "kind": "full", "items": [] }
```

### ☑ A5 — semantic tokens + folding ranges still work on the same session

**PASS.** Both returned non-error results for the valid buffer:

- `textDocument/semanticTokens/full` → 35-entry (7-token) data array, e.g. `[0,0,5,0,0, 0,6,4,2,1, 1,2,2,5,1, ...]` (keyword `model`, class `User`, properties/types for the two fields, decorator `@id`)
- `textDocument/foldingRange` → `[{ "startLine": 0, "endLine": 3, "kind": "region" }]` (the `model User { ... }` block)

## Findings

None. No blockers (🛑) and no non-blockers (⚠️) observed in Part A. The bridge, built CLI, pull-diagnostic transport, push suppression for pull-capable clients, and read features all behaved per spec. Not even the French managed to sabotage this run.

## Pre-QA gate note

This run relied on the closure build being green (it was). The workspace-level `pnpm test:packages` mongod caveat noted in the script's pre-QA gate was not re-verified in this run; the package-scoped signal was assumed per the slice-close notes.

## Part B status

**Not run.** Part B (visual browser check: B1 red squiggle appears, B2 marker clears, B3 no lag/flicker under a typing burst) requires a real browser rendering Monaco and is explicitly routed to the operator / a browser-equipped runner. The playground process used for this run has been stopped; restart with `pnpm --filter @prisma-next/lsp-playground start` before running Part B.
