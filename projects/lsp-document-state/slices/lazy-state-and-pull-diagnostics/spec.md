# Slice spec: lazy-state-and-pull-diagnostics

**Parent project:** `projects/lsp-document-state/spec.md`

## At a glance

Replace the language server's eager, defensive artifact handling with invalidate-on-change + lazy synchronous materialize-on-read, and move diagnostics from push to pull on the same model. After this slice: `didChange` only invalidates; the first read that needs derived state calls one synchronous `ensureCurrent(project, uri)` that reparses iff `TextDocument.version` advanced; completion / semantic tokens / folding / a new `textDocument/diagnostic` handler all consume that single per-project cache; `currentDocumentArtifact` and the per-request whole-text reparse are gone; `TextDocuments` stays as the text mirror / lifecycle / version source.

## Chosen design

- **`ensureCurrent(project, uri): CachedDocument | undefined`** — synchronous. Reads `TextDocuments` current text + `version`; if the cache's last-parsed version matches, returns the cache untouched; otherwise runs `parse` + `buildSymbolTable` once, stores the result (with the version) on the project's artifacts, and returns it. No `await` inside; no whole-document text compare.
- **`CachedDocument` gains the parsed `version`** (and may store its computed diagnostics) so the pull handler returns without recomputing and the version check is O(1).
- **`didChange` / `didOpen` invalidate only** — mark the document/project stale (or simply rely on the version bump that `TextDocuments` already applies). No parse, no `publishSafely` on the pull path.
- **Reads await readiness, then derive synchronously**: `const project = await resolveProjectForDocument(uri); const cached = ensureCurrent(project, uri); …`. The only awaited step is the cached project load. Position→offset uses the post-`ensureCurrent` `SourceFile`, never a stale one.
- **Pull diagnostics**: advertise `diagnosticProvider`; register `connection.languages.diagnostics.on` returning a full report from `ensureCurrent`. Gate on `InitializeParams.capabilities.textDocument?.diagnostic`: pull when present, push fallback otherwise — never both for one client. On config / watched-file change, send `workspace/diagnostic/refresh` when the client advertises `workspace.diagnostics.refreshSupport`.
- **Capability flags**: `{ interFileDependencies: false, workspaceDiagnostics: false }` with a code comment: single-input implementation scope, not a PSL property; flip with the future multi-input table.
- **Seam stays project-scoped**: the report builder is `buildReport(project, fileId)` able to carry `relatedDocuments` (empty today).

## Coherence rationale

One package (`language-server`), one architectural idea (invalidate + lazy materialize + pull), no behavior change to completion/semantic-tokens/folding beyond their data source. A reviewer holds it in one sitting and can roll it back as a unit. Lifecycle and transport are in the same PR because dropping eager compute is only safe once pull exists.

## Scope

**In:** `server.ts` (change/open/close handlers, `completeDocument`, `semanticTokensForDocument`, folding handler, `resolveProjectForDocument` usage, capability advert, new diagnostic pull handler, config-change refresh), `project-artifacts.ts` (`CachedDocument` version/diagnostics, `ensureCurrent` or equivalent), `document-diagnostics.ts` if the seam needs reshaping; their tests; README capability/diagnostics notes.

**Deliberately out:** removing `TextDocuments`; the multi-input project-wide symbol table; multi-project membership; `interFileDependencies: true` / `workspace/diagnostic`; any completion/semantic-token/folding behavior change; parser changes.

## Pre-investigated edge cases

| Case | Handling |
| --- | --- |
| Read arrives before the project's config has loaded | Read `await`s the in-flight cached load; once resolved, `ensureCurrent` derives from the live buffer. Returns `[]` / empty report only if the project genuinely can't load. |
| Client lacks `textDocument.diagnostic` | Keep the push path for that client; do not register/serve pull for it. Never run both. |
| Config / watched-file change while open | Invalidate affected docs; issue `workspace/diagnostic/refresh` (gated) instead of republishing. |
| Malformed PSL | Parser recovery still yields artifacts; the pull report returns recovered diagnostics, same as the push path does today. |
| Position mapping | Always map the request position against the `SourceFile` produced by `ensureCurrent` for the current version — never a stale cached one. |

## Slice-specific done conditions

- `didChange` performs no parse; an edit-then-immediate-completion serves the post-edit buffer with one parse and no per-request reparse (the case the removed `currentDocumentArtifact` was guarding) — covered by a test.
- Pull diagnostics serve the current cache; push remains only as the capability-gated fallback; `TextDocuments` is retained.

(CI-green, reviewer-accept, and the project-DoD floor are inherited, not restated.)

## Open questions

None.

## Dispatch plan

### Dispatch 1: lazy-ensurecurrent-seam

- **Outcome:** `ensureCurrent` exists (synchronous, version-keyed), `CachedDocument` carries the parsed version, completion / semantic tokens / folding read through it, and `currentDocumentArtifact` + the per-request whole-text reparse are deleted. Push diagnostics are still wired (unchanged) so nothing breaks mid-slice.
- **Builds on:** current `server.ts` / `project-artifacts.ts`.
- **Hands to:** a single synchronous materialize seam all reads share, with the version key in place.
- **Focus:** add `ensureCurrent`; thread parsed `version` onto `CachedDocument`; re-point the three read handlers; delete `currentDocumentArtifact`; keep `didChange`→`publish` for now; tests for version-skip (no reparse when unchanged) and edit-then-complete. Do not touch diagnostics transport yet.
- **Validation gates:** `pnpm --filter @prisma-next/language-server test` / `typecheck` / `lint`.

### Dispatch 2: pull-diagnostics-transport

- **Outcome:** Diagnostics served via `textDocument/diagnostic` from `ensureCurrent`, capability-gated with push fallback; eager `publish` dropped on the pull path; `didChange` becomes invalidate-only for pull clients; `workspace/diagnostic/refresh` on config change; flags + scope comment; README updated.
- **Builds on:** Dispatch 1's `ensureCurrent` seam.
- **Hands to:** the slice DoD — lazy lifecycle + pull transport complete.
- **Focus:** advertise `diagnosticProvider`; register the pull handler returning `buildReport(project, fileId)`; gate on client capability; remove eager compute on the pull path while keeping push fallback; refresh-on-config-change; capability flags + comment; tests for pull report, push fallback, refresh; playground pull-markers manual-QA.
- **Validation gates:** `pnpm --filter @prisma-next/language-server test` / `typecheck` / `lint`; `pnpm --filter @prisma-next/lsp-playground typecheck` / `lint`; manual playground pull-markers check.

## References

- Parent spec: `projects/lsp-document-state/spec.md`.
- Code: `packages/1-framework/3-tooling/language-server/src/{server.ts,project-artifacts.ts,document-diagnostics.ts}`.
- LSP 3.17 pull diagnostics (`textDocument/diagnostic`, `workspace/diagnostic/refresh`); `vscode-languageserver@10` `connection.languages.diagnostics`.
