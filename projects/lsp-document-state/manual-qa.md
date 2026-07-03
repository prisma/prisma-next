# Manual QA — lsp-document-state / lazy-state-and-pull-diagnostics

**What this script proves:** the playground (the end-user editor surface) receives pull-sourced diagnostics end-to-end — the server advertises `diagnosticProvider` to a pull-capable client, serves `textDocument/diagnostic` full reports for the live buffer, and does not push `textDocument/publishDiagnostics` to that client. This is the surface CI does not cover: the real `apps/lsp-playground` bridge (WebSocket → stdio → built CLI) with the real client capability set, not the in-package test harness.

**Audiences:** end users (playground editor experience). Extension authors: N/A — this slice changes no extension contract; the language-server package API surface (`createServer`/`startServer`) is unchanged.

## Pre-QA gate

Tree must be verified before running: `pnpm typecheck` green and `pnpm --filter @prisma-next/language-server test` green. (Workspace `pnpm test:packages` is red on machines without a launchable mongod — pre-existing, tracked in the slice-close notes; the package-scoped gate is the meaningful pre-QA signal here.)

## Part A — headless bridge smoke (agent-runnable)

Proves the pull transport through the real playground bridge and built CLI.

1. Build the closure: `pnpm --filter @prisma-next/lsp-playground... run --if-present build`.
2. Start the playground against a scratch schema: `pnpm --filter @prisma-next/lsp-playground start` (serves on `http://localhost:5295/`, WebSocket LSP bridge on the same port; runtime config JSON at `/__psl_playground_runtime.json`).
3. Connect a raw LSP client over the WebSocket bridge (script it with `ws` + `vscode-ws-jsonrpc`, both already in the playground's dependency closure) advertising `textDocument.diagnostic` (and `workspace.diagnostics.refreshSupport`) in `initialize`.
   - ☐ **A1:** the `initialize` result advertises `diagnosticProvider` with `interFileDependencies: false` and `workspaceDiagnostics: false`.
4. `didOpen` the staged scratch schema (URI + text from the runtime config / staged file) with a deliberate parse error (e.g. `model M {` unclosed).
   - ☐ **A2:** a `textDocument/diagnostic` request returns a **full** report whose items include the parse error, with sane ranges.
   - ☐ **A3:** no `textDocument/publishDiagnostics` notification arrives for this client (listen for the notification during the whole session).
5. Send a `didChange` fixing the error, then immediately request `textDocument/diagnostic` again.
   - ☐ **A4:** the report reflects the post-edit buffer (error gone) — the lazy path serves the synced document.
6. Regression sanity on the same session: request `textDocument/semanticTokens/full` and `textDocument/foldingRange`.
   - ☐ **A5:** both return non-error results for the valid buffer (read features share the same cache and still work over the bridge).

## Part B — visual browser check (human or browser-equipped agent)

Proves Monaco actually renders the pull-sourced markers — the piece a headless JSON-RPC session cannot certify.

1. With the playground still running, open `http://localhost:5295/` in a browser.
2. Introduce a parse error in the editor.
   - ☐ **B1:** a red squiggle + Problems-style marker appears for the error, live as you type.
3. Fix the error.
   - ☐ **B2:** the marker clears.
4. Type continuously (a burst of keystrokes).
   - ☐ **B3:** markers update without lag or flicker regressions vs. pre-change behavior.

## Blocker bar

🛑 Blocker: A1–A4 or B1–B2 failing. ⚠️ Non-blocker worth filing: A5 or B3 anomalies.

## Reports

One report per run under `projects/lsp-document-state/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`.
