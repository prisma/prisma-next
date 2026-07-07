# lsp-document-state

## Purpose

Give the language server a document-state lifecycle that is correct by construction and economical: editor features always compute against the buffer the client believes is synced, with no redundant reparsing, and the derived-state seam is shaped so it can grow from one open input to a multi-file project without re-architecting. The why is durable even as the *what* (which features, which diagnostics transport) evolves: the server's answers must match the synced document, cheaply, as the schema grows beyond a single file.

## At a glance

Today the server derives state eagerly and defensively: `onDidChangeContent` fires `publishSafely` → `publish`, which re-parses and pushes diagnostics asynchronously, and `completeDocument` calls `currentDocumentArtifact`, which re-parses again (comparing the *entire* document text) on the completion path to dodge a stale-buffer race. That is two parses per edit-then-complete, a per-request O(n) text compare, and a race the LSP spec says we shouldn't have to fight.

The settled model replaces that with **invalidate-on-change, lazily materialize-on-read, synchronously**:

```text
didOpen /
didChange  ──▶  mark the document dirty (evict its cache entry)  (cheap; no parse)

read req   ──▶  await project load (only while uncached)      (async: config eval, cached)
            ──▶  ensureCurrent(project, uri)                  (SYNC: reparse iff marked dirty)
            ──▶  derive (completion / diagnostics / …)        (SYNC: no await before deriving)
```

`ensureCurrent` is the one synchronous seam that turns the current `TextDocuments` text into the project's `SymbolTable` + per-document `CachedDocument`, and only when the document was marked dirty (opened, edited, or its config reloaded) since we last parsed. Every read feature consumes that one cache. A burst of keystrokes with no intervening read costs zero parses; a read after N edits costs one. Because the parse is synchronous CPU with no `await` between “get current text” and “derive”, the result is internally consistent for the buffer it ran against — which is exactly the synchronization the spec assumes — without snapshots or cancellation (rust-analyzer needs those only because its reads run on background threads; ours don't).

Diagnostics move to the same philosophy: pull (`textDocument/diagnostic`) instead of push, so they too are computed on demand from the current cache rather than eagerly on every change. This is the standardized form of tsserver's `geterr` model.

## Non-goals

- **Removing `TextDocuments`.** It is kept as the synchronously-maintained incremental text mirror, the open/close lifecycle source, and the monotonic `version` provider. The project demotes its role (features no longer derive from it directly) but does not replace it.
- **Building the project-wide, multi-input symbol table.** Today the table is built from the single open configured input; merging several inputs (and reading unopened inputs from disk) remains deferred cross-file work, owned by a future project.
- **Multi-project membership / tsserver-style file→project(s) mapping.** `resolveProjectForDocument` stays one-config-one-project here.
- **Flipping `interFileDependencies` to `true` or implementing `workspace/diagnostic` (`workspaceDiagnostics`).** Both are gated on the multi-input table and ship in the future project that delivers it.
- **Behavioural changes to completion, semantic tokens, or folding.** They are re-pointed at the new cache with identical observable behavior; new completion/semantic features are out of scope.
- **Editor-extension or client-side work** beyond verifying the playground renders pull-sourced diagnostics.

## Place in the larger world

- Lives entirely in `packages/1-framework/3-tooling/language-server` — `server.ts` (request/notification wiring, `publish`/`completeDocument`/`resolveProjectForDocument`), `project-artifacts.ts` (`CachedDocument`, `ProjectArtifacts.update`), `document-diagnostics.ts` (the pure parse + symbol-table + diagnostics seam).
- Builds on `@prisma-next/psl-parser` (`parse()`, `buildSymbolTable()`, `SourceFile.offsetAt`/`positionAt`) — all synchronous; and on `@prisma-next/config-loader` for project resolution, which is **asynchronous** because `prisma-next.config.ts` is executable TypeScript evaluated via dynamic import (unlike tsserver's synchronously-readable JSON `tsconfig`). That async is the reason project load can't be synchronous; the parse/derive steps remain synchronous.
- Server library `vscode-languageserver@10` exposes the pull-diagnostics API (`connection.languages.diagnostics.on`, `diagnosticProvider`); LSP 3.17 defines the document-pull contract. The playground client (`monaco-languageclient@10` on `vscode-languageclient@9` + `@codingame/monaco-vscode-api@25`) supports pull diagnostics through the same path VS Code uses.
- Sibling: the `lsp-autocomplete` project (PR #871) added completion on the existing eager artifact cache; this project reworks the lifecycle underneath it. The `Project` abstraction this project leans on is the same seam `lsp-autocomplete` already depends on.

## Cross-cutting requirements

- A change notification only **invalidates**; it never parses. The single per-project artifact cache is the one source every read feature consumes — no feature keeps its own parse/token cache, and no read re-derives independently.
- `ensureCurrent(project, uri)` is the only place raw text becomes derived state, it is **synchronous**, and it recomputes only when the document was marked dirty by one of the enumerated mutation points (didOpen, didChange, config/watched-file reload). A read of a clean document does zero parsing.
- Reads are correct under interleaving without snapshots/cancellation: there is no `await` between reading the current buffer text and deriving from it, so a derived result is always internally consistent for one version.
- Asynchrony is confined to project/config resolution (cached per config, de-duped). Notification handlers stay fire-and-forget; the not-yet-loaded window is handled by **read handlers awaiting readiness**, never by trying to make a notification handler a barrier.
- The defensive per-request reparse (`currentDocumentArtifact`) and whole-document text compare are removed; freshness is keyed on explicit dirty marks at the mutation points — didOpen, didChange, and config reload — the only handlers that can change what a parse would produce.
- Diagnostics are served by pull when the client advertises `textDocument.diagnostic`, computed from the current cache; push is retained only as a capability-gated fallback for non-pull clients. The two transports are never both active for one client.
- The artifact and diagnostics seams stay **project-scoped**: the report builder is `buildReport(project, fileId)` capable of carrying `relatedDocuments`, even though it returns a single file today — so the future multi-file flip is additive, not a rewrite.

## Transitional-shape constraints

- `TextDocuments` is retained for the life of this project; every intermediate slice still routes raw text through it.
- Diagnostics capability flags ship as `{ interFileDependencies: false, workspaceDiagnostics: false }`, accompanied by a code comment stating this reflects the current single-input implementation scope — not a property of PSL — and must flip with the multi-input symbol table. Advertising a cross-file capability we don't yet honor is forbidden.
- Every merged slice keeps completion, diagnostics, semantic tokens, and folding behavior green, and keeps non-pull clients working via the push fallback. No slice leaves the server advertising a transport it doesn't serve.
- No slice introduces an `await` on the parse/derive path; the only awaited step is the cached project load.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited from `drive/calibration/dod.md`).
- [ ] `currentDocumentArtifact`, the per-request reparse, and the whole-document text compare are gone; all read handlers (completion, diagnostics, semantic tokens, folding) materialize state through a single synchronous `ensureCurrent` against the per-project cache.
- [ ] `ensureCurrent` recomputes only when the document was marked dirty; a read of a clean document performs no parse (covered by a test).
- [ ] A change notification performs no parse; an edit→read sequence does no async work on the hot path once the project is cached (covered by a test, including the edit-then-immediate-completion case that motivated the original stale-buffer fix).
- [ ] Diagnostics are served via `textDocument/diagnostic`, capability-gated, with push retained as fallback for clients lacking `textDocument.diagnostic`, and `workspace/diagnostic/refresh` issued on config/watched-file change when the client supports it.
- [ ] `TextDocuments` is still the text mirror / lifecycle / version source; it was not removed.
- [ ] `interFileDependencies: false` / `workspaceDiagnostics: false` are advertised with the scope-comment described above.
- [ ] Completion, semantic tokens, and folding have unchanged observable behavior (covered by the existing suites staying green).
- [ ] The playground renders pull-sourced diagnostics end-to-end (manual-QA report).

## Open Questions

1. **Resolved (operator).** Eager `publish` is dropped on the pull path: a change only invalidates, and diagnostics are computed on demand at pull time. `publish` survives only behind the capability-gated non-pull fallback. The lazy model is real, not hybrid.
2. **Resolved (operator).** One slice — lazy lifecycle and pull diagnostics ship together (they are coupled: dropping eager compute requires the pull transport to exist).
3. Linear Project: none created yet. Working position: create one under the Terminal team during the plan/ceremony step before slicing.

## References

- Linear Project: not yet created (Terminal team) — to be created at planning time.
- Sibling / dependent projects: `lsp-autocomplete` (PR #871) — completion built on the current eager cache this project reworks.
- Code references: `packages/1-framework/3-tooling/language-server/src/{server.ts,project-artifacts.ts,document-diagnostics.ts}`; `@prisma-next/psl-parser` (`parse`, `buildSymbolTable`, `SourceFile`); `vscode-languageserver@10` pull-diagnostics API.
- External: LSP 3.17 — Document Synchronization (didChange version/ordering guarantee) and Pull Diagnostics (`textDocument/diagnostic`, `workspace/diagnostic/refresh`). Prior art surveyed: rust-analyzer (`process_changes` + salsa snapshot/cancellation) and tsserver (`ScriptInfo`/`TextStorage` version, `synchronizeHostData` lazy recompute, `geterr` pull).
- ADRs: none yet; if the invalidate/lazy/version lifecycle proves durable, capture it as an ADR at close-out (per `drive/project/README.md` ADR cadence).
